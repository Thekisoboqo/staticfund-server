import './style.css';
import { initAuth, getCurrentUser, signUp, signIn, signOut } from './js/auth.js';
import {
  fetchIssues, getIssue, createIssue, toggleVote, hasVoted,
  getVoteCount, getSolutions, submitSolution, submitContribution,
  getLeaderboard, CATEGORIES, getCategoryInfo
} from './js/issues.js';
import { showToast, timeAgo, getInitials } from './js/utils.js';

// ============================================
// SPA Router
// ============================================
const routes = {
  '/': renderHomePage,
  '/report': renderReportPage,
  '/issue': renderIssuePage,
  '/leaderboard': renderLeaderboardPage,
  '/login': renderAuthPage,
};

function navigate(path, params = {}) {
  const url = new URL(window.location);
  url.pathname = path;
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  history.pushState({}, '', url);
  routeChanged();
}

function routeChanged() {
  const path = window.location.pathname;
  const handler = routes[path] || renderHomePage;
  const app = document.getElementById('app');
  app.innerHTML = '';
  app.appendChild(renderNavbar());
  handler(app);
}

window.addEventListener('popstate', routeChanged);
window.navigate = navigate;

// ============================================
// Navbar
// ============================================
function renderNavbar() {
  const user = getCurrentUser();
  const nav = document.createElement('nav');
  nav.className = 'navbar';
  nav.innerHTML = `
    <div class="container">
      <a href="/" class="nav-logo" onclick="event.preventDefault(); navigate('/')">
        <div class="logo-icon">🏙️</div>
        <span>Mangaung<span style="color: var(--primary)">Fix</span></span>
      </a>
      <ul class="nav-links" id="navLinks">
        <li><a href="/" onclick="event.preventDefault(); navigate('/')" class="${location.pathname === '/' ? 'active' : ''}">🏠 Issues</a></li>
        <li><a href="/report" onclick="event.preventDefault(); navigate('/report')" class="${location.pathname === '/report' ? 'active' : ''}">📸 Report</a></li>
        <li><a href="/leaderboard" onclick="event.preventDefault(); navigate('/leaderboard')" class="${location.pathname === '/leaderboard' ? 'active' : ''}">🏆 Heroes</a></li>
      </ul>
      <div class="nav-actions">
        ${user ? `
          <span style="color: var(--text-secondary); font-size: 0.85rem;">👋 ${user.email.split('@')[0]}</span>
          <button class="btn btn-ghost btn-sm" id="logoutBtn">Sign Out</button>
        ` : `
          <button class="btn btn-primary btn-sm" id="loginBtn">Sign In</button>
        `}
        <button class="hamburger" id="hamburgerBtn">☰</button>
      </div>
    </div>
  `;

  setTimeout(() => {
    const logoutBtn = nav.querySelector('#logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', async () => {
      await signOut();
      navigate('/');
    });

    const loginBtn = nav.querySelector('#loginBtn');
    if (loginBtn) loginBtn.addEventListener('click', () => navigate('/login'));

    const hamburger = nav.querySelector('#hamburgerBtn');
    if (hamburger) hamburger.addEventListener('click', () => {
      nav.querySelector('#navLinks').classList.toggle('open');
    });
  }, 0);

  return nav;
}

// ============================================
// Home Page (Issue Feed)
// ============================================
async function renderHomePage(app) {
  const section = document.createElement('section');
  section.innerHTML = `
    <div class="hero">
      <div class="container">
        <div class="hero-badge">🇿🇦 Mangaung Community Platform</div>
        <h1>Fix <span class="highlight">Mangaung</span> Together</h1>
        <p>Report issues in Bloemfontein. Vote for what matters. Solve problems as a community. Let's make our city better, together.</p>
        <div class="hero-actions">
          <button class="btn btn-primary btn-lg" id="heroReportBtn">📸 Report an Issue</button>
          <button class="btn btn-secondary btn-lg" id="heroBrowseBtn">🔍 Browse Issues</button>
        </div>
        <div class="hero-stats" id="heroStats">
          <div class="hero-stat"><div class="stat-number" id="statIssues">-</div><div class="stat-label">Issues Reported</div></div>
          <div class="hero-stat"><div class="stat-number" id="statVotes">-</div><div class="stat-label">Community Votes</div></div>
          <div class="hero-stat"><div class="stat-number" id="statSolved">-</div><div class="stat-label">Problems Solved</div></div>
        </div>
      </div>
    </div>

    <div class="container" id="feedSection">
      <h2 class="section-title">🔥 Community Issues</h2>
      <p class="section-subtitle">Vote for problems you want to see fixed — top-voted issues get government attention</p>
      
      <div class="filter-bar">
        <div class="search-wrapper">
          <span class="search-icon">🔍</span>
          <input type="text" class="search-input" id="searchInput" placeholder="Search issues in Mangaung...">
        </div>
        <button class="filter-chip active" data-cat="all">All</button>
        ${CATEGORIES.map(c => `<button class="filter-chip" data-cat="${c.id}">${c.label}</button>`).join('')}
      </div>

      <div class="issues-grid" id="issuesGrid">
        <div class="spinner"></div>
      </div>
    </div>
  `;
  app.appendChild(section);

  // Wire up buttons
  section.querySelector('#heroReportBtn').addEventListener('click', () => {
    const user = getCurrentUser();
    if (!user) { navigate('/login'); return; }
    navigate('/report');
  });

  section.querySelector('#heroBrowseBtn').addEventListener('click', () => {
    document.getElementById('feedSection').scrollIntoView({ behavior: 'smooth' });
  });

  // Wire up filters
  let activeCategory = 'all';
  section.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      section.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeCategory = chip.dataset.cat;
      loadIssues();
    });
  });

  // Search
  let searchTimeout;
  section.querySelector('#searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadIssues(), 400);
  });

  // Load issues
  async function loadIssues() {
    const grid = section.querySelector('#issuesGrid');
    grid.innerHTML = '<div class="spinner"></div>';
    
    try {
      const searchVal = section.querySelector('#searchInput').value;
      const issues = await fetchIssues({ category: activeCategory, search: searchVal });

      // Update stats
      section.querySelector('#statIssues').textContent = issues.length;
      const totalVotes = issues.reduce((sum, i) => sum + i.vote_count, 0);
      section.querySelector('#statVotes').textContent = totalVotes;
      const solved = issues.filter(i => i.status === 'solved').length;
      section.querySelector('#statSolved').textContent = solved;

      if (issues.length === 0) {
        grid.innerHTML = `
          <div class="empty-state" style="grid-column: 1 / -1;">
            <div class="empty-icon">🏙️</div>
            <h3>No issues found</h3>
            <p>Be the first to report an issue in Mangaung!</p>
            <button class="btn btn-primary" onclick="navigate('/report')">📸 Report Issue</button>
          </div>
        `;
        return;
      }

      grid.innerHTML = issues.map(issue => {
        const cat = getCategoryInfo(issue.category);
        return `
          <div class="issue-card" onclick="navigate('/issue', { id: '${issue.id}' })">
            ${issue.image_url ? `<img src="${issue.image_url}" alt="${issue.title}" class="issue-card-image" loading="lazy">` : 
              `<div class="issue-card-image" style="background: linear-gradient(135deg, var(--bg-card), var(--bg-secondary)); display: flex; align-items: center; justify-content: center; font-size: 3rem; opacity: 0.3;">📸</div>`}
            <div class="issue-card-body">
              <div class="issue-card-header">
                <div>
                  <span class="issue-category ${cat.class}">${cat.label}</span>
                  <span class="status-badge status-${issue.status}" style="margin-left: 8px;">${issue.status === 'open' ? '🔴 Open' : issue.status === 'in-progress' ? '🟡 In Progress' : '🟢 Solved'}</span>
                </div>
              </div>
              <h3 class="issue-card-title">${issue.title}</h3>
              <p class="issue-card-desc">${issue.description}</p>
              <div class="issue-card-meta">
                <span class="issue-location">📍 ${issue.location || 'Mangaung'}</span>
                <div class="issue-card-actions">
                  <span class="vote-btn" onclick="event.stopPropagation();">🔺 ${issue.vote_count}</span>
                  <span class="comment-count">💬 ${timeAgo(issue.created_at)}</span>
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      grid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><div class="empty-icon">⚠️</div><h3>Something went wrong</h3><p>${err.message}</p></div>`;
    }
  }

  loadIssues();
}

// ============================================
// Report Issue Page
// ============================================
function renderReportPage(app) {
  const user = getCurrentUser();
  if (!user) { navigate('/login'); return; }

  const section = document.createElement('section');
  section.style.padding = '100px 0 60px';
  section.innerHTML = `
    <div class="container" style="max-width: 700px;">
      <h2 class="section-title">📸 Report an Issue</h2>
      <p class="section-subtitle">Describe the problem and upload a photo so the community can see it.</p>

      <div class="card-glass" style="padding: 32px; border-radius: var(--radius-xl);">
        <form id="reportForm">
          <div class="form-group">
            <label class="form-label">📷 Upload Photo</label>
            <div class="upload-area" id="uploadArea">
              <div class="upload-icon">📸</div>
              <p class="upload-text">Drag & drop or <span>click to browse</span></p>
              <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 8px;">JPG, PNG • Max 5MB</p>
              <input type="file" accept="image/*" id="fileInput" style="display: none;">
              <img class="upload-preview hidden" id="previewImage" alt="Preview">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">📝 Title</label>
            <input type="text" class="form-input" id="issueTitle" placeholder="e.g., Massive pothole on Nelson Mandela Drive" required>
          </div>

          <div class="form-group">
            <label class="form-label">📋 Category</label>
            <select class="form-select" id="issueCategory" required>
              <option value="">Select a category...</option>
              ${CATEGORIES.map(c => `<option value="${c.id}">${c.label}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">📍 Location</label>
            <input type="text" class="form-input" id="issueLocation" placeholder="e.g., Westdene, Church Street near Mimosa Mall">
          </div>

          <div class="form-group">
            <label class="form-label">📖 Description</label>
            <textarea class="form-textarea" id="issueDescription" placeholder="Describe the issue in detail. What's the problem? How long has it been like this? How does it affect the community?" rows="5" required></textarea>
          </div>

          <button type="submit" class="btn btn-primary btn-lg" style="width: 100%;" id="submitBtn">
            🚀 Submit Report
          </button>
        </form>
      </div>
    </div>
  `;
  app.appendChild(section);

  // File upload
  let selectedFile = null;
  const uploadArea = section.querySelector('#uploadArea');
  const fileInput = section.querySelector('#fileInput');
  const preview = section.querySelector('#previewImage');

  uploadArea.addEventListener('click', () => fileInput.click());
  uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  function handleFile(file) {
    if (file.size > 5 * 1024 * 1024) {
      showToast('File too large! Max 5MB', 'error');
      return;
    }
    selectedFile = file;
    preview.src = URL.createObjectURL(file);
    preview.classList.remove('hidden');
    uploadArea.querySelector('.upload-icon').classList.add('hidden');
    uploadArea.querySelector('.upload-text').classList.add('hidden');
  }

  // Form submit
  section.querySelector('#reportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = section.querySelector('#submitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Uploading...';

    try {
      await createIssue({
        title: section.querySelector('#issueTitle').value,
        description: section.querySelector('#issueDescription').value,
        category: section.querySelector('#issueCategory').value,
        location: section.querySelector('#issueLocation').value,
        imageFile: selectedFile
      });
      showToast('Issue reported successfully! 🎉', 'success');
      navigate('/');
    } catch (err) {
      showToast(err.message, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = '🚀 Submit Report';
    }
  });
}

// ============================================
// Issue Detail Page
// ============================================
async function renderIssuePage(app) {
  const params = new URLSearchParams(window.location.search);
  const issueId = params.get('id');
  if (!issueId) { navigate('/'); return; }

  const section = document.createElement('section');
  section.className = 'issue-detail';
  section.innerHTML = `<div class="container"><div class="spinner"></div></div>`;
  app.appendChild(section);

  try {
    const issue = await getIssue(issueId);
    const solutions = await getSolutions(issueId);
    const userVoted = await hasVoted(issueId);
    const voteCount = await getVoteCount(issueId);
    const cat = getCategoryInfo(issue.category);

    section.innerHTML = `
      <div class="container">
        <button class="btn btn-ghost" onclick="navigate('/')" style="margin-bottom: 20px;">← Back to Issues</button>
        
        ${issue.image_url ? `
          <div class="issue-detail-hero">
            <img src="${issue.image_url}" alt="${issue.title}" class="issue-detail-image">
          </div>
        ` : ''}

        <div class="issue-detail-content">
          <div class="issue-detail-main">
            <div style="display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap;">
              <span class="issue-category ${cat.class}">${cat.label}</span>
              <span class="status-badge status-${issue.status}">${issue.status === 'open' ? '🔴 Open' : issue.status === 'in-progress' ? '🟡 In Progress' : '🟢 Solved'}</span>
            </div>
            
            <h1>${issue.title}</h1>
            
            <div class="issue-meta-row">
              <div class="meta-item">👤 ${issue.author_name}</div>
              <div class="meta-item">📍 ${issue.location || 'Mangaung'}</div>
              <div class="meta-item">🕐 ${timeAgo(issue.created_at)}</div>
            </div>

            <p class="issue-description">${issue.description}</p>

            <!-- Solutions Section -->
            <div class="solutions-section">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
                <h2 class="section-title" style="margin-bottom: 0;">💪 Solutions</h2>
                <button class="btn btn-success" id="proposeSolnBtn">🛠️ I Can Fix This!</button>
              </div>

              ${solutions.length > 0 ? solutions.map(sol => `
                <div class="solution-card" id="sol-${sol.id}">
                  <div class="solution-header">
                    <div class="solution-avatar">${getInitials(sol.solver_name)}</div>
                    <div>
                      <div class="solution-user">${sol.solver_name}</div>
                      <div class="solution-time">${timeAgo(sol.created_at)}</div>
                    </div>
                  </div>
                  ${sol.proof_image_url ? `<img src="${sol.proof_image_url}" alt="Solution proof" class="solution-image">` : ''}
                  <p class="solution-text">${sol.description}</p>
                  <div class="contribution-bar">
                    <button class="contribute-btn" onclick="openContributeModal('${sol.id}')">🎁 Thank & Contribute</button>
                    <span class="contribution-total">Community appreciation</span>
                  </div>
                </div>
              `).join('') : `
                <div class="empty-state">
                  <div class="empty-icon">🛠️</div>
                  <h3>No solutions yet</h3>
                  <p>Be the first community hero to solve this problem!</p>
                </div>
              `}
            </div>
          </div>

          <!-- Sidebar -->
          <div class="issue-sidebar">
            <div class="sidebar-card">
              <h3>🔺 Vote for Priority</h3>
              <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 16px;">More votes = higher priority for government attention</p>
              <button class="big-vote-btn ${userVoted ? 'voted' : ''}" id="bigVoteBtn">
                ${userVoted ? '✅ Voted' : '🔺 Upvote This Issue'}
              </button>
              <div class="vote-count-display">
                <div class="vote-count-number" id="voteCountNum">${voteCount}</div>
                <div class="vote-count-label">community votes</div>
              </div>
            </div>

            <div class="sidebar-card">
              <h3>📊 Issue Info</h3>
              <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
                <div style="display: flex; justify-content: space-between; font-size: 0.9rem;">
                  <span style="color: var(--text-muted);">Category</span>
                  <span class="issue-category ${cat.class}">${cat.label}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.9rem;">
                  <span style="color: var(--text-muted);">Status</span>
                  <span>${issue.status}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.9rem;">
                  <span style="color: var(--text-muted);">Solutions</span>
                  <span>${solutions.length}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.9rem;">
                  <span style="color: var(--text-muted);">Reported by</span>
                  <span>${issue.author_name}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Vote button
    section.querySelector('#bigVoteBtn').addEventListener('click', async () => {
      const user = getCurrentUser();
      if (!user) { navigate('/login'); return; }
      
      try {
        const voted = await toggleVote(issueId);
        const btn = section.querySelector('#bigVoteBtn');
        const newCount = await getVoteCount(issueId);
        section.querySelector('#voteCountNum').textContent = newCount;
        
        if (voted) {
          btn.className = 'big-vote-btn voted';
          btn.innerHTML = '✅ Voted';
          showToast('Vote registered! 🎉', 'success');
        } else {
          btn.className = 'big-vote-btn';
          btn.innerHTML = '🔺 Upvote This Issue';
          showToast('Vote removed', 'info');
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Propose solution
    section.querySelector('#proposeSolnBtn').addEventListener('click', () => {
      const user = getCurrentUser();
      if (!user) { navigate('/login'); return; }
      openSolutionModal(issueId);
    });

  } catch (err) {
    section.innerHTML = `<div class="container"><div class="empty-state"><div class="empty-icon">⚠️</div><h3>Issue not found</h3><p>${err.message}</p><button class="btn btn-primary" onclick="navigate('/')">Go Home</button></div></div>`;
  }
}

// ============================================
// Solution Modal
// ============================================
function openSolutionModal(issueId) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>🛠️ Submit Your Solution</h3>
      <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 20px;">
        Describe how you fixed (or plan to fix) this issue. Upload a before/after photo as proof.
      </p>
      <form id="solutionForm">
        <div class="form-group">
          <label class="form-label">📷 Proof Photo</label>
          <div class="upload-area" id="solUploadArea" style="padding: 20px;">
            <div class="upload-icon" style="font-size: 2rem;">📸</div>
            <p class="upload-text" style="font-size: 0.85rem;">Click to upload proof</p>
            <input type="file" accept="image/*" id="solFileInput" style="display: none;">
            <img class="upload-preview hidden" id="solPreview" alt="Preview">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">📖 What did you do?</label>
          <textarea class="form-textarea" id="solDescription" placeholder="Describe how you solved or plan to solve this issue..." rows="4" required></textarea>
        </div>
        <div style="display: flex; gap: 8px;">
          <button type="button" class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
          <button type="submit" class="btn btn-success" style="flex: 1;" id="solSubmitBtn">🚀 Submit Solution</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  let solFile = null;
  const solUpload = overlay.querySelector('#solUploadArea');
  const solInput = overlay.querySelector('#solFileInput');
  const solPreview = overlay.querySelector('#solPreview');

  solUpload.addEventListener('click', () => solInput.click());
  solInput.addEventListener('change', (e) => {
    if (e.target.files[0]) {
      solFile = e.target.files[0];
      solPreview.src = URL.createObjectURL(solFile);
      solPreview.classList.remove('hidden');
    }
  });

  overlay.querySelector('#solutionForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = overlay.querySelector('#solSubmitBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Submitting...';

    try {
      await submitSolution({
        issueId,
        description: overlay.querySelector('#solDescription').value,
        imageFile: solFile
      });
      showToast('Solution submitted! You earned 50 points! 🏆', 'success');
      overlay.remove();
      navigate('/issue', { id: issueId });
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = '🚀 Submit Solution';
    }
  });
}

// ============================================
// Contribution Modal
// ============================================
window.openContributeModal = function(solutionId) {
  const user = getCurrentUser();
  if (!user) { navigate('/login'); return; }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>🎁 Thank This Community Hero</h3>
      <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 20px;">
        Show your appreciation for someone who stepped up to fix a community problem!
      </p>
      <form id="contributeForm">
        <div class="form-group">
          <label class="form-label">💰 Contribution Amount (R)</label>
          <input type="number" class="form-input" id="contribAmount" placeholder="e.g., 50" min="1" step="1" required>
        </div>
        <div class="form-group">
          <label class="form-label">💬 Message (optional)</label>
          <input type="text" class="form-input" id="contribMessage" placeholder="e.g., Thank you for cleaning our community!">
        </div>
        <div style="display: flex; gap: 8px;">
          <button type="button" class="btn btn-ghost" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
          <button type="submit" class="btn btn-success" style="flex: 1;">🎁 Contribute</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#contributeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await submitContribution({
        solutionId,
        amount: overlay.querySelector('#contribAmount').value,
        message: overlay.querySelector('#contribMessage').value
      });
      showToast('Thank you for your contribution! 🎉', 'success');
      overlay.remove();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
};

// ============================================
// Leaderboard Page
// ============================================
async function renderLeaderboardPage(app) {
  const section = document.createElement('section');
  section.className = 'leaderboard-page';
  section.innerHTML = `
    <div class="container" style="max-width: 700px;">
      <h2 class="section-title" style="text-align: center;">🏆 Community Heroes</h2>
      <p class="section-subtitle" style="text-align: center;">The people making Mangaung better, one solution at a time</p>
      <div class="leaderboard-list" id="leaderboardList">
        <div class="spinner"></div>
      </div>
    </div>
  `;
  app.appendChild(section);

  try {
    const leaders = await getLeaderboard();
    const list = section.querySelector('#leaderboardList');

    if (leaders.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🏆</div>
          <h3>No heroes yet</h3>
          <p>Be the first to solve a community issue and make the leaderboard!</p>
          <button class="btn btn-primary" onclick="navigate('/')">Browse Issues</button>
        </div>
      `;
      return;
    }

    list.innerHTML = leaders.map((leader, i) => `
      <div class="leaderboard-item">
        <div class="leaderboard-rank">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</div>
        <div class="leaderboard-avatar">${getInitials(leader.display_name)}</div>
        <div class="leaderboard-info">
          <div class="leaderboard-name">${leader.display_name || 'Anonymous'}</div>
          <div class="leaderboard-solved">Community hero</div>
        </div>
        <div class="leaderboard-points">${leader.points || 0} pts</div>
      </div>
    `).join('');
  } catch (err) {
    section.querySelector('#leaderboardList').innerHTML = `<p style="color: var(--text-muted); text-align: center;">Could not load leaderboard</p>`;
  }
}

// ============================================
// Auth Page
// ============================================
function renderAuthPage(app) {
  const section = document.createElement('section');
  section.innerHTML = `
    <div class="auth-container">
      <div class="auth-card">
        <h2 id="authTitle">Welcome Back</h2>
        <p class="auth-subtitle" id="authSubtitle">Sign in to report issues and vote for your community</p>
        
        <form id="authForm">
          <div class="form-group hidden" id="nameGroup">
            <label class="form-label">Full Name</label>
            <input type="text" class="form-input" id="authName" placeholder="e.g., Thabo Mokoena">
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" class="form-input" id="authEmail" placeholder="your@email.com" required>
          </div>
          <div class="form-group">
            <label class="form-label">Password</label>
            <input type="password" class="form-input" id="authPassword" placeholder="••••••••" required minlength="6">
          </div>
          <button type="submit" class="btn btn-primary btn-lg" style="width: 100%;" id="authSubmitBtn">Sign In</button>
        </form>

        <div class="auth-toggle">
          <span id="authToggleText">Don't have an account?</span>
          <a href="#" id="authToggleLink">Sign Up</a>
        </div>
      </div>
    </div>
  `;
  app.appendChild(section);

  let isLogin = true;
  const toggleLink = section.querySelector('#authToggleLink');
  
  toggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    isLogin = !isLogin;
    section.querySelector('#authTitle').textContent = isLogin ? 'Welcome Back' : 'Join Mangaung Fix';
    section.querySelector('#authSubtitle').textContent = isLogin ? 'Sign in to report issues and vote for your community' : 'Create an account to start fixing Mangaung together';
    section.querySelector('#nameGroup').classList.toggle('hidden', isLogin);
    section.querySelector('#authSubmitBtn').textContent = isLogin ? 'Sign In' : 'Create Account';
    section.querySelector('#authToggleText').textContent = isLogin ? "Don't have an account?" : 'Already have an account?';
    toggleLink.textContent = isLogin ? 'Sign Up' : 'Sign In';
  });

  section.querySelector('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = section.querySelector('#authSubmitBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Please wait...';

    const email = section.querySelector('#authEmail').value;
    const password = section.querySelector('#authPassword').value;
    const name = section.querySelector('#authName').value;

    try {
      if (isLogin) {
        await signIn(email, password);
        showToast('Welcome back! 🎉', 'success');
      } else {
        await signUp(email, password, name);
        showToast('Account created! Check your email to confirm 📧', 'success');
      }
      navigate('/');
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = isLogin ? 'Sign In' : 'Create Account';
    }
  });
}

// ============================================
// Auth state listener
// ============================================
window.addEventListener('authChange', () => {
  routeChanged();
});

// ============================================
// Initialize App
// ============================================
async function init() {
  await initAuth();
  routeChanged();
}

init();
