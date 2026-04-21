import { supabase } from './supabase.js';
import { getCurrentUser } from './auth.js';

// ---- Fetch all issues ----
export async function fetchIssues({ category = null, search = '', sortBy = 'votes' } = {}) {
  let query = supabase
    .from('issues')
    .select(`
      *,
      profiles!issues_profile_id_fkey(display_name),
      issue_votes(count)
    `);

  if (category && category !== 'all') {
    query = query.eq('category', category);
  }
  if (search) {
    query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;

  // Attach vote count
  const issues = data.map(issue => ({
    ...issue,
    vote_count: issue.issue_votes?.[0]?.count || 0,
    author_name: issue.profiles?.display_name || 'Anonymous'
  }));

  // Sort
  if (sortBy === 'votes') {
    issues.sort((a, b) => b.vote_count - a.vote_count);
  }

  return issues;
}

// ---- Get single issue ----
export async function getIssue(id) {
  const { data, error } = await supabase
    .from('issues')
    .select(`
      *,
      profiles!issues_profile_id_fkey(display_name, points),
      issue_votes(count)
    `)
    .eq('id', id)
    .single();

  if (error) throw error;
  return {
    ...data,
    vote_count: data.issue_votes?.[0]?.count || 0,
    author_name: data.profiles?.display_name || 'Anonymous'
  };
}

// ---- Create issue ----
export async function createIssue({ title, description, category, location, imageFile }) {
  const user = getCurrentUser();
  if (!user) throw new Error('You must be logged in to report an issue');

  let image_url = null;

  if (imageFile) {
    const fileExt = imageFile.name.split('.').pop();
    const fileName = `${user.id}_${Date.now()}.${fileExt}`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('issue-photos')
      .upload(fileName, imageFile, { cacheControl: '3600', upsert: false });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('issue-photos')
      .getPublicUrl(fileName);

    image_url = urlData.publicUrl;
  }

  const { data, error } = await supabase
    .from('issues')
    .insert({
      title,
      description,
      category,
      location,
      image_url,
      user_id: user.id,
      status: 'open'
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ---- Vote on issue ----
export async function toggleVote(issueId) {
  const user = getCurrentUser();
  if (!user) throw new Error('You must be logged in to vote');

  // Check if already voted
  const { data: existing } = await supabase
    .from('issue_votes')
    .select('id')
    .eq('issue_id', issueId)
    .eq('user_id', user.id)
    .single();

  if (existing) {
    // Remove vote
    await supabase.from('issue_votes').delete().eq('id', existing.id);
    return false;
  } else {
    // Add vote
    await supabase.from('issue_votes').insert({
      issue_id: issueId,
      user_id: user.id
    });
    return true;
  }
}

// ---- Check if user voted ----
export async function hasVoted(issueId) {
  const user = getCurrentUser();
  if (!user) return false;

  const { data } = await supabase
    .from('issue_votes')
    .select('id')
    .eq('issue_id', issueId)
    .eq('user_id', user.id)
    .single();

  return !!data;
}

// ---- Get vote count ----
export async function getVoteCount(issueId) {
  const { count } = await supabase
    .from('issue_votes')
    .select('*', { count: 'exact', head: true })
    .eq('issue_id', issueId);

  return count || 0;
}

// ---- Get solutions for issue ----
export async function getSolutions(issueId) {
  const { data, error } = await supabase
    .from('solutions')
    .select(`
      *,
      profiles!solutions_profile_id_fkey(display_name, points)
    `)
    .eq('issue_id', issueId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data.map(s => ({
    ...s,
    solver_name: s.profiles?.display_name || 'Anonymous'
  }));
}

// ---- Submit solution ----
export async function submitSolution({ issueId, description, imageFile }) {
  const user = getCurrentUser();
  if (!user) throw new Error('You must be logged in to submit a solution');

  let proof_image_url = null;

  if (imageFile) {
    const fileExt = imageFile.name.split('.').pop();
    const fileName = `solution_${user.id}_${Date.now()}.${fileExt}`;
    
    const { error: uploadError } = await supabase.storage
      .from('issue-photos')
      .upload(fileName, imageFile, { cacheControl: '3600', upsert: false });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('issue-photos')
      .getPublicUrl(fileName);

    proof_image_url = urlData.publicUrl;
  }

  const { data, error } = await supabase
    .from('solutions')
    .insert({
      issue_id: issueId,
      user_id: user.id,
      description,
      proof_image_url
    })
    .select()
    .single();

  if (error) throw error;

  // Give solver points
  await supabase.rpc('increment_points', { user_id: user.id, amount: 50 });

  return data;
}

// ---- Submit contribution ----
export async function submitContribution({ solutionId, amount, message }) {
  const user = getCurrentUser();
  if (!user) throw new Error('You must be logged in to contribute');

  const { data, error } = await supabase
    .from('contributions')
    .insert({
      solution_id: solutionId,
      user_id: user.id,
      amount: parseFloat(amount),
      message
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ---- Get contributions for solution ----
export async function getContributions(solutionId) {
  const { data, error } = await supabase
    .from('contributions')
    .select(`
      *,
      profiles!contributions_profile_id_fkey(display_name)
    `)
    .eq('solution_id', solutionId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

// ---- Leaderboard ----
export async function getLeaderboard() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('points', { ascending: false })
    .limit(20);

  if (error) throw error;
  return data;
}

// ---- Categories ----
export const CATEGORIES = [
  { id: 'pothole', label: '🕳️ Potholes', class: 'category-pothole' },
  { id: 'water', label: '💧 Water Issues', class: 'category-water' },
  { id: 'garbage', label: '🗑️ Garbage', class: 'category-garbage' },
  { id: 'crime', label: '🚨 Crime Spots', class: 'category-crime' },
  { id: 'electricity', label: '⚡ Electricity', class: 'category-electricity' },
  { id: 'infrastructure', label: '🏗️ Infrastructure', class: 'category-infrastructure' },
  { id: 'other', label: '📋 Other', class: 'category-other' }
];

export function getCategoryInfo(categoryId) {
  return CATEGORIES.find(c => c.id === categoryId) || CATEGORIES[CATEGORIES.length - 1];
}
