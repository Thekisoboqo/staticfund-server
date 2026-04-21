import { supabase } from './supabase.js';

// ---- State ----
let currentUser = null;

export function getCurrentUser() {
  return currentUser;
}

// ---- Init Auth ----
export async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    currentUser = session.user;
    await ensureProfile(session.user);
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (session) {
      currentUser = session.user;
      await ensureProfile(session.user);
    } else {
      currentUser = null;
    }
    updateAuthUI();
  });

  updateAuthUI();
}

// ---- Ensure profile exists ----
async function ensureProfile(user) {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .single();

  if (!data) {
    await supabase.from('profiles').insert({
      id: user.id,
      display_name: user.email.split('@')[0],
      email: user.email,
      points: 0
    });
  }
}

// ---- Sign Up ----
export async function signUp(email, password, name) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: name }
    }
  });
  if (error) throw error;
  return data;
}

// ---- Sign In ----
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (error) throw error;
  return data;
}

// ---- Sign Out ----
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  currentUser = null;
  updateAuthUI();
}

// ---- Update Auth UI ----
function updateAuthUI() {
  const event = new CustomEvent('authChange', { detail: { user: currentUser } });
  window.dispatchEvent(event);
}
