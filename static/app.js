// --- Global App State ---
let documents = [];
let timelineEvents = [];
let graphData = { nodes: [], links: [] };

// --- Notification State ---
let notifications = [];

function pushNotification(type, message) {
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    notifications.unshift({ type, message, timeStr, unread: true });
    renderNotifications();
}

function renderNotifications() {
    const list = document.getElementById('notif-list');
    const pulse = document.getElementById('notif-pulse');
    if (!list) return;

    const unread = notifications.filter(n => n.unread).length;
    if (pulse) pulse.classList.toggle('hidden', unread === 0);

    if (notifications.length === 0) {
        list.innerHTML = '<div class="notif-empty"><i class="fa-solid fa-check-circle"></i> All caught up!</div>';
        return;
    }

    const iconMap = { upload: 'fa-file-arrow-up', chat: 'fa-comments', system: 'fa-bolt' };
    list.innerHTML = notifications.map(n => `
        <div class="notif-item ${n.unread ? 'unread' : ''}">
            <div class="notif-icon ${n.type}">
                <i class="fa-solid ${iconMap[n.type] || 'fa-bell'}"></i>
            </div>
            <div class="notif-text">
                <p>${n.message}</p>
                <span>${n.timeStr}</span>
            </div>
        </div>
    `).join('');
}

function toggleNotifications() {
    const dropdown = document.getElementById('notif-dropdown');
    if (!dropdown) return;
    const isOpen = dropdown.classList.toggle('open');
    if (isOpen) {
        notifications.forEach(n => n.unread = false);
        renderNotifications();
    }
}

function clearNotifications(e) {
    e.stopPropagation();
    notifications = [];
    renderNotifications();
    document.getElementById('notif-dropdown').classList.remove('open');
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const bell = document.getElementById('notif-bell');
    if (bell && !bell.contains(e.target)) {
        const dd = document.getElementById('notif-dropdown');
        if (dd) dd.classList.remove('open');
    }
});

// --- Active Tab State ---
let activeTab = 'dashboard';

// --- Graph Simulation State ---
let selectedNode = null;
let graphCanvas, ctx;
let isDraggingGraph = false;
let dragNode = null;
let zoomScale = 1.0;
let panOffsetX = 0;
let panOffsetY = 0;
let dragStartX = 0, dragStartY = 0;

// --- Authentication State & Handlers ---
let currentOtpCode = null;
let otpResendTimer = null;
let otpSent = false; // track if OTP was already sent

function initAuth() {
    const overlay = document.getElementById('login-overlay');
    const googleBtn = document.getElementById('google-signin-btn');
    const phoneSubmitBtn = document.getElementById('phone-submit-btn');
    const signoutBtn = document.getElementById('signout-btn');
    
    const googleEmailNextBtn = document.getElementById('google-email-next-btn');
    const googleEmailInput = document.getElementById('google-email-input');
    const googlePasswordInput = document.getElementById('google-password-input');
    const googleStepEmail = document.getElementById('google-step-email');
    const googleStepPassword = document.getElementById('google-step-password');
    const googleEmailDisplay = document.getElementById('google-email-display');
    const googleAccountPill = document.getElementById('google-account-pill');
    const googleErrorMsg = document.getElementById('google-error-msg');

    // Check local storage auth
    const authState = localStorage.getItem('mv_auth');
    if (authState) {
        overlay.style.display = 'none';
        updateProfileDisplay(authState);
        refreshData();
        setTimeout(() => {
            pushNotification('system', '🔐 Signed in & identity synced successfully.');
            pushNotification('chat', '🤖 ChatGPT AI Assistant is ready. Ask anything!');
        }, 800);
    } else {
        overlay.style.display = 'flex';
    }

    // Google Next Event
    if (googleEmailNextBtn) {
        googleEmailNextBtn.addEventListener('click', () => {
            const email = googleEmailInput.value.trim();
            if (!email || !email.includes('@')) {
                alert('Please enter a valid Google email address.');
                return;
            }
            
            fetch('/api/auth/google/next', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email })
            })
            .then(res => {
                if (!res.ok) return res.json().then(err => { throw new Error(err.detail || 'Email validation failed'); });
                return res.json();
            })
            .then(data => {
                googleEmailDisplay.innerText = data.email;
                googleStepEmail.style.display = 'none';
                googleStepPassword.style.display = 'block';
                googleErrorMsg.style.display = 'none';
                googlePasswordInput.value = '';
                googlePasswordInput.focus();
            })
            .catch(err => {
                alert(err.message);
            });
        });
    }

    // Google Account Pill click (go back to email step)
    if (googleAccountPill) {
        googleAccountPill.addEventListener('click', () => {
            googleStepPassword.style.display = 'none';
            googleStepEmail.style.display = 'block';
            googleEmailInput.focus();
        });
    }

    // Google Sign-In Event (Submit Password)
    if (googleBtn) {
        googleBtn.addEventListener('click', () => {
            const email = googleEmailInput.value.trim();
            const password = googlePasswordInput.value;
            if (!password || password.length < 6) {
                googleErrorMsg.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Password must be at least 6 characters.';
                googleErrorMsg.style.display = 'block';
                return;
            }
            
            fetch('/api/auth/google/signin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email, password: password })
            })
            .then(res => {
                if (!res.ok) return res.json().then(err => { throw new Error(err.detail || 'Authentication failed'); });
                return res.json();
            })
            .then(data => {
                googleErrorMsg.style.display = 'none';
                runSimulatedSync(data.auth_state, data.display_name);
            })
            .catch(err => {
                googleErrorMsg.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${err.message}`;
                googleErrorMsg.style.display = 'block';
            });
        });
    }

    // Phone / OTP Verification Flow
    phoneSubmitBtn.addEventListener('click', handlePhoneAuthStep);

    // Sign Out Event
    signoutBtn.addEventListener('click', () => {
        localStorage.removeItem('mv_auth');
        otpSent = false;
        currentOtpCode = null;
        clearInterval(otpResendTimer);
        
        // Reset phone input
        document.getElementById('login-phone').value = '';
        document.getElementById('login-phone').disabled = false;
        document.getElementById('otp-verification-container').style.display = 'none';
        document.getElementById('phone-submit-btn').innerHTML = `<i class="fa-solid fa-paper-plane"></i> Send Verification Code`;
        for (let i = 1; i <= 4; i++) {
            const el = document.getElementById(`otp-${i}`);
            if (el) { el.value = ''; el.dataset.keydownBound = ''; }
        }
        const timerEl = document.querySelector('.otp-timer');
        if (timerEl) timerEl.innerHTML = `Resend OTP in <span id="otp-timer-seconds">30</span>s`;
        
        // Reset Google inputs
        if (googleEmailInput) googleEmailInput.value = '';
        if (googlePasswordInput) googlePasswordInput.value = '';
        if (googleStepEmail) googleStepEmail.style.display = 'block';
        if (googleStepPassword) googleStepPassword.style.display = 'none';
        if (googleErrorMsg) googleErrorMsg.style.display = 'none';
        
        // Reset login panel view to Google tab
        overlay.style.display = 'flex';
        document.getElementById('login-syncing').style.display = 'none';
        document.querySelector('.login-tabs').style.display = 'flex';
        switchLoginMethod('google');
    });

    // Initialize Google Identity Services (GSI)
    checkAndInitGoogleGSI();
}

function toggleGooglePassword() {
    const pwInput = document.getElementById('google-password-input');
    const pwIcon = document.getElementById('toggle-pw-icon');
    if (pwInput && pwIcon) {
        if (pwInput.type === 'password') {
            pwInput.type = 'text';
            pwIcon.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
            pwInput.type = 'password';
            pwIcon.classList.replace('fa-eye-slash', 'fa-eye');
        }
    }
}

function handleCredentialResponse(response) {
    // Send ID Token to real backend verification endpoint
    fetch('/api/auth/google/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: response.credential })
    })
    .then(res => {
        if (!res.ok) return res.json().then(err => { throw new Error(err.detail || 'Google sign-in failed.'); });
        return res.json();
    })
    .then(data => {
        runSimulatedSync(data.auth_state, data.display_name);
    })
    .catch(err => {
        alert(err.message);
    });
}

function checkAndInitGoogleGSI() {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
        // Fetch config parameters from the backend securely
        fetch('/api/auth/config')
        .then(res => res.json())
        .then(config => {
            if (config.google_client_id) {
                google.accounts.id.initialize({
                    client_id: config.google_client_id,
                    callback: handleCredentialResponse
                });
                
                const container = document.getElementById('google-gsi-container');
                const divider = document.getElementById('google-gsi-divider');
                if (container) {
                    google.accounts.id.renderButton(
                        container,
                        { theme: "outline", size: "large", width: 280, text: "signin_with" }
                    );
                    if (divider) divider.style.display = 'block';
                }
            }
        })
        .catch(err => console.log("Google GSI Config failed to load:", err));
    } else {
        // Retry polling in case script is loaded asynchronously
        setTimeout(checkAndInitGoogleGSI, 500);
    }
}

function updateProfileDisplay(authState) {
    const sidebarName = document.getElementById('user-profile-name');
    const headerName = document.getElementById('header-user-profile-name');
    
    let displayName = 'Alex Dev';
    if (authState === 'google') {
        displayName = 'Alex Dev (Google)';
    } else if (authState && authState.startsWith('google-')) {
        const email = authState.replace('google-', '');
        // Extract a display name from email (e.g. alex.dev@gmail.com -> Alex Dev)
        let namePart = email.split('@')[0];
        let capitalized = namePart
            .replace(/[\._-]/g, ' ')
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        displayName = `${capitalized} (Google)`;
    } else if (authState && authState.startsWith('phone-')) {
        const phone = authState.replace('phone-', '');
        // Show last 4 digits for brevity
        const shortPhone = phone.length > 4 ? '...' + phone.slice(-4) : phone;
        displayName = `Alex (${shortPhone})`;
    }
    
    if (sidebarName) sidebarName.innerText = displayName;
    if (headerName) headerName.innerText = displayName;
}

function runSimulatedSync(authType, label) {
    const panels = document.querySelectorAll('.login-panel');
    const tabs = document.querySelector('.login-tabs');
    const syncing = document.getElementById('login-syncing');
    const subtext = document.getElementById('syncing-subtext');
    
    panels.forEach(p => p.style.display = 'none');
    tabs.style.display = 'none';
    syncing.style.display = 'flex';
    
    subtext.innerText = "Connecting to identity database...";
    
    setTimeout(() => {
        subtext.innerText = "Syncing certificates and mapping skill vectors...";
        
        setTimeout(() => {
            // Store Auth State
            localStorage.setItem('mv_auth', authType);
            updateProfileDisplay(authType);
            
            // Hide Overlay
            const overlay = document.getElementById('login-overlay');
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.style.display = 'none';
                overlay.style.opacity = '1';
                // Restore login panel state for future signouts
                tabs.style.display = 'flex';
                switchLoginMethod('google');
            }, 500);
            
            // Refresh data
            refreshData();
        }, 1200);
    }, 1000);
}

function switchLoginMethod(method) {
    const tabGoogle = document.getElementById('login-tab-google');
    const tabPhone = document.getElementById('login-tab-phone');
    const panelGoogle = document.getElementById('login-panel-google');
    const panelPhone = document.getElementById('login-panel-phone');
    
    if (method === 'google') {
        tabGoogle.classList.add('active');
        tabPhone.classList.remove('active');
        panelGoogle.classList.add('active');
        panelPhone.classList.remove('active');
    } else {
        tabGoogle.classList.remove('active');
        tabPhone.classList.add('active');
        panelGoogle.classList.remove('active');
        panelPhone.classList.add('active');
    }
}

function handlePhoneAuthStep() {
    const phoneInput = document.getElementById('login-phone');
    const phoneVal = phoneInput.value.trim();
    const otpContainer = document.getElementById('otp-verification-container');
    const submitBtn = document.getElementById('phone-submit-btn');
    
    if (!phoneVal) {
        alert('Please enter a valid mobile number.');
        return;
    }
    
    if (!otpSent) {
        // --- STEP 1: Send OTP ---
        fetch('/api/auth/phone/send-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: phoneVal })
        })
        .then(res => {
            if (!res.ok) return res.json().then(err => { throw new Error(err.detail || 'Failed to send OTP'); });
            return res.json();
        })
        .then(data => {
            currentOtpCode = data.otp;
            otpSent = true;
            
            alert(`📱 MemoryVerse OTP Code: ${currentOtpCode}\n\n(Generated & verified by the real backend API)`);
            console.log(`[BACKEND SMS] MemoryVerse OTP: ${currentOtpCode}`);
            
            // Show OTP input boxes
            otpContainer.style.display = 'block';
            submitBtn.innerHTML = `<i class="fa-solid fa-circle-check"></i> Verify & Access`;
            phoneInput.disabled = true;
            
            // Countdown timer
            let seconds = 30;
            const timerSpan = document.getElementById('otp-timer-seconds');
            if (timerSpan) timerSpan.innerText = seconds;
            
            clearInterval(otpResendTimer);
            otpResendTimer = setInterval(() => {
                seconds--;
                if (timerSpan) timerSpan.innerText = seconds;
                if (seconds <= 0) {
                    clearInterval(otpResendTimer);
                    const timerEl = document.querySelector('.otp-timer');
                    if (timerEl) timerEl.innerHTML = `Didn't receive code? <a href="#" onclick="resendOtp()" style="color:var(--cyan)">Resend OTP</a>`;
                }
            }, 1000);
            
            // Auto-focus first OTP digit
            setTimeout(() => {
                const firstDigit = document.getElementById('otp-1');
                if (firstDigit) firstDigit.focus();
            }, 150);
        })
        .catch(err => {
            alert(`❌ Error: ${err.message}`);
        });
        
    } else {
        // --- STEP 2: Verify OTP ---
        const d1 = document.getElementById('otp-1').value;
        const d2 = document.getElementById('otp-2').value;
        const d3 = document.getElementById('otp-3').value;
        const d4 = document.getElementById('otp-4').value;
        const code = d1 + d2 + d3 + d4;
        
        if (code.length < 4) {
            alert('Please enter all 4 digits of your OTP code.');
            return;
        }
        
        fetch('/api/auth/phone/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: phoneVal, code: code })
        })
        .then(res => {
            if (!res.ok) return res.json().then(err => { throw new Error(err.detail || 'Verification failed'); });
            return res.json();
        })
        .then(data => {
            clearInterval(otpResendTimer);
            otpSent = false;
            runSimulatedSync(data.auth_state, data.display_name);
        })
        .catch(err => {
            alert(`❌ Error: ${err.message}`);
            for (let i = 1; i <= 4; i++) {
                document.getElementById(`otp-${i}`).value = '';
            }
            document.getElementById('otp-1').focus();
        });
    }
}

function resendOtp() {
    otpSent = false;
    currentOtpCode = null;
    const otpContainer = document.getElementById('otp-verification-container');
    otpContainer.style.display = 'none';
    for (let i = 1; i <= 4; i++) {
        const el = document.getElementById(`otp-${i}`);
        if (el) el.value = '';
    }
    const timerEl = document.querySelector('.otp-timer');
    if (timerEl) timerEl.innerHTML = `Resend OTP in <span id="otp-timer-seconds">30</span>s`;
    document.getElementById('login-phone').disabled = false;
    handlePhoneAuthStep();
}

function moveOtpFocus(current, nextId, prevId) {
    // Move forward on input
    if (current.value.length === 1 && nextId) {
        const next = document.getElementById(nextId);
        if (next) next.focus();
    }
    // Move backward on backspace (only set once using dataset flag)
    if (!current.dataset.keydownBound) {
        current.dataset.keydownBound = 'true';
        current.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && current.value.length === 0 && prevId) {
                const prev = document.getElementById(prevId);
                if (prev) prev.focus();
            }
        });
    }
}

// --- Initialize App ---
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initTabs();
    initUploadZone();
    initSearchAndChat();
    initGraphCanvas();
});

// --- Tab Navigation ---
function initTabs() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tabId = item.getAttribute('data-tab');
            switchTab(tabId);
        });
    });
}

function switchTab(tabId) {
    activeTab = tabId;
    
    // Toggle Nav Bar Active Style
    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('data-tab') === tabId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    // Toggle Content Views
    document.querySelectorAll('.tab-pane').forEach(pane => {
        if (pane.id === tabId) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });

    // Specific Tab Loading Triggers
    if (tabId === 'relations') {
        setTimeout(() => {
            if (graphCanvas && graphCanvas.parentElement) {
                const rect = graphCanvas.parentElement.getBoundingClientRect();
                graphCanvas.width = rect.width;
                graphCanvas.height = rect.height;
            }
            startGraphSimulation();
        }, 100);
    }
}

// --- Fetch Data from Backend API ---
async function refreshData() {
    try {
        const docRes = await fetch('/api/documents');
        documents = await docRes.json();
        
        const timelineRes = await fetch('/api/timeline');
        timelineEvents = await timelineRes.json();
        
        const graphRes = await fetch('/api/relationships');
        graphData = graphRes.json ? await graphRes.json() : { nodes: [], links: [] };

        updateDashboardStats();
        renderDocumentsTable();
        renderCategoryBreakdown();
        renderSkillCloud();
        renderTimeline();
        
        if (activeTab === 'relations') {
            startGraphSimulation();
        }
    } catch (err) {
        console.error("Error refreshing data:", err);
    }
}

// --- Dashboard Component Rendering ---
function updateDashboardStats() {
    document.getElementById('stat-total-docs').innerText = documents.length;
    
    const certsCount = documents.filter(d => d.category === 'Certifications').length;
    document.getElementById('stat-total-certs').innerText = certsCount;
    
    const projectsCount = documents.filter(d => d.category === 'Projects').length;
    document.getElementById('stat-total-projects').innerText = projectsCount;
    
    const internsCount = documents.filter(d => d.category === 'Internships').length;
    document.getElementById('stat-total-interns').innerText = internsCount;
}

function renderDocumentsTable() {
    const tableBody = document.getElementById('document-table-body');
    tableBody.innerHTML = '';
    
    if (documents.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No documents loaded. Go to AI Ingestion to upload records.</td></tr>`;
        return;
    }
    
    documents.forEach(doc => {
        const row = document.createElement('tr');
        
        // Category Badge Class Mapping
        let badgeClass = 'acad';
        if (doc.category === 'Certifications') badgeClass = 'cert';
        else if (doc.category === 'Projects') badgeClass = 'proj';
        else if (doc.category === 'Internships') badgeClass = 'intern';
        else if (doc.category === 'Achievements') badgeClass = 'ach';
        else if (doc.category === 'Skills') badgeClass = 'skill';
        
        // Render up to 3 skills as chips
        const skillsSnippet = doc.skills.slice(0, 3).map(sk => `<span class="skill-chip">${sk}</span>`).join(' ');
        const remainingSkills = doc.skills.length > 3 ? `<span class="skill-chip" style="opacity: 0.7;">+${doc.skills.length - 3}</span>` : '';
        
        row.innerHTML = `
            <td>
                <div class="td-doc-name" style="cursor: pointer;" title="Search this document">
                    <i class="fa-regular fa-file-lines"></i>
                    <span>${doc.title}</span>
                </div>
            </td>
            <td><span class="badge ${badgeClass}">${doc.category}</span></td>
            <td>${doc.organization || 'Not Specified'}</td>
            <td>${doc.year || 'N/A'}</td>
            <td><div class="skill-chips">${skillsSnippet} ${remainingSkills}</div></td>
            <td>
                <button class="btn-delete" onclick="deleteDocument('${doc.id}')" title="Delete Document">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </td>
        `;
        
        // Add click listener to search this document
        row.querySelector('.td-doc-name').addEventListener('click', () => {
            switchTab('chat');
            const searchInput = document.getElementById('semantic-search-input');
            if (searchInput) {
                searchInput.value = doc.title;
                performSemanticSearch(doc.title);
            }
        });

        tableBody.appendChild(row);
    });
}

function renderCategoryBreakdown() {
    const categories = ["Projects", "Skills", "Certifications", "Internships", "Achievements", "Academics"];
    const container = document.getElementById('category-breakdown-list');
    container.innerHTML = '';
    
    categories.forEach(cat => {
        const count = documents.filter(d => d.category === cat).length;
        const total = documents.length || 1;
        const pct = Math.round((count / total) * 100);
        
        // Icons mapping
        let icon = 'fa-file-invoice';
        if (cat === 'Certifications') icon = 'fa-award';
        else if (cat === 'Projects') icon = 'fa-code';
        else if (cat === 'Internships') icon = 'fa-business-time';
        else if (cat === 'Achievements') icon = 'fa-trophy';
        else if (cat === 'Skills') icon = 'fa-layer-group';
        
        const catDiv = document.createElement('div');
        catDiv.className = 'category-item';
        catDiv.innerHTML = `
            <div class="cat-item-left">
                <i class="fa-solid ${icon}"></i>
                <span>${cat}</span>
            </div>
            <div class="cat-item-count">${count} (${pct}%)</div>
        `;
        container.appendChild(catDiv);
    });
}

function renderSkillCloud() {
    const cloudContainer = document.getElementById('extracted-skill-cloud');
    cloudContainer.innerHTML = '';
    
    // Aggregate skills
    const skillCounts = {};
    documents.forEach(doc => {
        doc.skills.forEach(sk => {
            skillCounts[sk] = (skillCounts[sk] || 0) + 1;
        });
    });
    
    const sortedSkills = Object.keys(skillCounts).sort((a, b) => skillCounts[b] - skillCounts[a]);
    
    if (sortedSkills.length === 0) {
        cloudContainer.innerHTML = `<p style="font-size: 0.8rem; color: var(--text-muted); text-align: center; width: 100%;">No skills mapped yet.</p>`;
        return;
    }
    
    sortedSkills.forEach(skill => {
        const chip = document.createElement('span');
        chip.className = 'cloud-chip';
        chip.innerText = `${skill} (${skillCounts[skill]})`;
        chip.addEventListener('click', () => {
            // Switch to search assistant and search this skill
            switchTab('chat');
            document.getElementById('semantic-search-input').value = skill;
            performSemanticSearch(skill);
        });
        cloudContainer.appendChild(chip);
    });
}

async function deleteDocument(docId) {
    if (!confirm("Are you sure you want to remove this document from your digital identity? This will remove its indexed semantic vectors and relationships.")) {
        return;
    }
    try {
        await fetch(`/api/documents/${docId}`, { method: 'DELETE' });
        refreshData();
    } catch (err) {
        console.error("Error deleting document:", err);
    }
}

// --- Upload Component & AI Ingestion ---
function initUploadZone() {
    const dropzone = document.getElementById('file-dropzone');
    const fileInput = document.getElementById('file-input');
    const browseBtn = document.getElementById('browse-btn');
    
    browseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });
    
    dropzone.addEventListener('click', () => {
        fileInput.click();
    });
    
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });
    
    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
    });
    
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        handleFilesUpload(files);
    });
    
    fileInput.addEventListener('change', (e) => {
        handleFilesUpload(e.target.files);
    });
}

async function handleFilesUpload(files) {
    if (files.length === 0) return;
    
    const queueList = document.getElementById('upload-queue-list');
    
    // Clear queue empty state if present
    const emptyState = queueList.querySelector('.empty-state');
    if (emptyState) queueList.innerHTML = '';
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // Add to UI queue list
        const queueItemId = `upload-item-${Date.now()}-${i}`;
        const itemDiv = document.createElement('div');
        itemDiv.className = 'queue-item';
        itemDiv.id = queueItemId;
        itemDiv.innerHTML = `
            <div class="queue-icon"><i class="fa-solid fa-file-arrow-up"></i></div>
            <div class="queue-details">
                <div class="queue-filename">${file.name}</div>
                <div class="progress-bar-container">
                    <div class="progress-bar" id="progress-${queueItemId}"></div>
                </div>
            </div>
            <div class="queue-status" id="status-${queueItemId}">Analyzing...</div>
        `;
        queueList.appendChild(itemDiv);
        
        // Run Simulated Progress then Upload
        simulateUploadAndProcess(file, queueItemId);
    }
}

function simulateUploadAndProcess(file, queueItemId) {
    const progressBar = document.getElementById(`progress-${queueItemId}`);
    const statusText = document.getElementById(`status-${queueItemId}`);
    
    let progress = 0;
    const interval = setInterval(async () => {
        progress += 10;
        if (progressBar) progressBar.style.width = `${progress}%`;
        
        if (progress >= 100) {
            clearInterval(interval);
            if (statusText) statusText.innerText = "Indexing...";
            
            // Perform actual API upload
            const formData = new FormData();
            formData.append('file', file);
            
            try {
                const res = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });
                
                if (res.ok) {
                    if (statusText) {
                        statusText.innerText = "Completed";
                        statusText.style.color = "var(--cyan)";
                    }
                    pushNotification('upload', `📄 "${file.name}" ingested & indexed by AI.`);
                    setTimeout(() => {
                        const item = document.getElementById(queueItemId);
                        if (item) item.remove();
                        refreshData();
                    }, 1500);
                } else {
                    const errDetail = await res.json();
                    if (statusText) {
                        statusText.innerText = "Failed";
                        statusText.style.color = "var(--magenta)";
                    }
                    alert(`Upload failed for ${file.name}: ${errDetail.detail || 'Internal Error'}`);
                }
            } catch (err) {
                if (statusText) {
                    statusText.innerText = "Error";
                    statusText.style.color = "var(--magenta)";
                }
                console.error("Upload error:", err);
            }
        }
    }, 120);
}

// --- Journey Timeline Rendering ---
function renderTimeline() {
    const container = document.getElementById('timeline-events-list');
    container.innerHTML = '';
    
    if (timelineEvents.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-timeline"></i>
                <p>No timeline milestones found. Ingest files with dates to construct your timeline.</p>
            </div>
        `;
        return;
    }
    
    timelineEvents.forEach(evt => {
        const card = document.createElement('div');
        card.className = 'timeline-card';
        
        const skillsChips = evt.skills.map(sk => `<span class="skill-chip">${sk}</span>`).join(' ');
        
        card.innerHTML = `
            <div class="timeline-year">${evt.year || 'Continuous'}</div>
            <h3 class="timeline-title">${evt.title}</h3>
            <div class="timeline-org">
                <i class="fa-solid fa-building-columns"></i> ${evt.organization || 'Independent'}
            </div>
            <div class="skill-chips">${skillsChips}</div>
        `;
        container.appendChild(card);
    });
}

// --- Relationship Graph Logic (HTML5 Canvas Force-Directed Layout) ---
function initGraphCanvas() {
    graphCanvas = document.getElementById('relation-canvas');
    ctx = graphCanvas.getContext('2d');
    
    // Handle Window Resize
    function resizeCanvas() {
        const rect = graphCanvas.parentElement.getBoundingClientRect();
        graphCanvas.width = rect.width;
        graphCanvas.height = rect.height;
    }
    
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    
    // Drag & Zoom Listeners
    graphCanvas.addEventListener('mousedown', (e) => {
        const rect = graphCanvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left - panOffsetX) / zoomScale;
        const mouseY = (e.clientY - rect.top - panOffsetY) / zoomScale;
        
        // Check if node is clicked
        dragNode = null;
        for (let n of graphData.nodes) {
            const dist = Math.hypot(n.x - mouseX, n.y - mouseY);
            if (dist < (n.val || 10) * 1.5) {
                dragNode = n;
                selectedNode = n;
                renderGraphDetails(n);
                break;
            }
        }
        
        if (!dragNode) {
            isDraggingGraph = true;
            dragStartX = e.clientX - panOffsetX;
            dragStartY = e.clientY - panOffsetY;
        }
    });
    
    graphCanvas.addEventListener('mousemove', (e) => {
        const rect = graphCanvas.getBoundingClientRect();
        if (dragNode) {
            dragNode.x = (e.clientX - rect.left - panOffsetX) / zoomScale;
            dragNode.y = (e.clientY - rect.top - panOffsetY) / zoomScale;
        } else if (isDraggingGraph) {
            panOffsetX = e.clientX - dragStartX;
            panOffsetY = e.clientY - dragStartY;
        }
    });
    
    window.addEventListener('mouseup', () => {
        dragNode = null;
        isDraggingGraph = false;
    });
    
    graphCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomIntensity = 0.05;
        if (e.deltaY < 0) {
            zoomScale = Math.min(zoomScale + zoomIntensity, 2.5);
        } else {
            zoomScale = Math.max(zoomScale - zoomIntensity, 0.4);
        }
    });
}

let physicsAnimationFrameId = null;

function startGraphSimulation() {
    if (!graphData.nodes || graphData.nodes.length === 0) return;
    
    // Stop any existing simulation loop to prevent exponential acceleration
    if (physicsAnimationFrameId) {
        cancelAnimationFrame(physicsAnimationFrameId);
        physicsAnimationFrameId = null;
    }

    const w = graphCanvas.width;
    const h = graphCanvas.height;
    
    // Initialize node positions if they don't exist
    graphData.nodes.forEach(n => {
        if (n.x === undefined) n.x = w / 2 + (Math.random() - 0.5) * 200;
        if (n.y === undefined) n.y = h / 2 + (Math.random() - 0.5) * 200;
        n.vx = 0;
        n.vy = 0;
    });
    
    // Animation loop using spring forces
    function updatePhysics() {
        if (activeTab !== 'relations') return;
        
        const k = 0.03;  // Spring constant
        const repulse = 600; // Repulsion constant
        const centerGravity = 0.01;
        const damping = 0.85;
        
        // Repulsion between nodes
        for (let i = 0; i < graphData.nodes.length; i++) {
            let n1 = graphData.nodes[i];
            for (let j = i + 1; j < graphData.nodes.length; j++) {
                let n2 = graphData.nodes[j];
                let dx = n2.x - n1.x;
                let dy = n2.y - n1.y;
                let dist = Math.hypot(dx, dy) || 1;
                
                if (dist < 220) {
                    let force = repulse / (dist * dist);
                    let fx = (dx / dist) * force;
                    let fy = (dy / dist) * force;
                    
                    n1.vx -= fx;
                    n1.vy -= fy;
                    n2.vx += fx;
                    n2.vy += fy;
                }
            }
        }
        
        // Attraction along links
        graphData.links.forEach(link => {
            let src = graphData.nodes.find(n => n.id === link.source);
            let tgt = graphData.nodes.find(n => n.id === link.target);
            if (src && tgt) {
                let dx = tgt.x - src.x;
                let dy = tgt.y - src.y;
                let dist = Math.hypot(dx, dy) || 1;
                
                let targetDist = 80;
                let force = (dist - targetDist) * k;
                let fx = (dx / dist) * force;
                let fy = (dy / dist) * force;
                
                src.vx += fx;
                src.vy += fy;
                tgt.vx -= fx;
                tgt.vy -= fy;
            }
        });
        
        // Gravity to center
        const cx = w / (2 * zoomScale);
        const cy = h / (2 * zoomScale);
        graphData.nodes.forEach(n => {
            if (n === dragNode) return;
            
            n.vx += (cx - n.x) * centerGravity;
            n.vy += (cy - n.y) * centerGravity;
            
            n.x += n.vx;
            n.y += n.vy;
            
            n.vx *= damping;
            n.vy *= damping;
        });
        
        drawGraph();
        physicsAnimationFrameId = requestAnimationFrame(updatePhysics);
    }
    
    physicsAnimationFrameId = requestAnimationFrame(updatePhysics);
}

function drawGraph() {
    ctx.clearRect(0, 0, graphCanvas.width, graphCanvas.height);
    
    ctx.save();
    ctx.translate(panOffsetX, panOffsetY);
    ctx.scale(zoomScale, zoomScale);
    
    // Draw links
    ctx.lineWidth = 1;
    graphData.links.forEach(link => {
        let src = graphData.nodes.find(n => n.id === link.source);
        let tgt = graphData.nodes.find(n => n.id === link.target);
        if (src && tgt) {
            ctx.beginPath();
            ctx.moveTo(src.x, src.y);
            ctx.lineTo(tgt.x, tgt.y);
            
            // Fade lines based on relation type
            ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
            if (selectedNode && (src.id === selectedNode.id || tgt.id === selectedNode.id)) {
                ctx.strokeStyle = "rgba(162, 89, 255, 0.4)";
                ctx.lineWidth = 1.8;
            } else {
                ctx.lineWidth = 1;
            }
            ctx.stroke();
        }
    });
    
    // Draw nodes
    graphData.nodes.forEach(n => {
        const radius = (n.val || 10) * 1.1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI);
        
        // Node styling based on type
        let color = '#fff';
        let shadowColor = 'rgba(255,255,255,0.2)';
        
        if (n.type === 'category') {
            color = '#ff007f'; // Magenta
            shadowColor = 'rgba(255, 0, 127, 0.6)';
        } else if (n.type === 'document') {
            color = '#a259ff'; // Purple
            shadowColor = 'rgba(162, 89, 255, 0.6)';
        } else if (n.type === 'skill') {
            color = '#00f2fe'; // Cyan
            shadowColor = 'rgba(0, 242, 254, 0.6)';
        }
        
        ctx.fillStyle = color;
        ctx.shadowBlur = selectedNode && selectedNode.id === n.id ? 20 : 6;
        ctx.shadowColor = shadowColor;
        ctx.fill();
        
        // Reset shadow
        ctx.shadowBlur = 0;
        
        // Draw inner accent ring for selected node
        if (selectedNode && selectedNode.id === n.id) {
            ctx.beginPath();
            ctx.arc(n.x, n.y, radius + 4, 0, 2 * Math.PI);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
        
        // Draw labels
        ctx.fillStyle = '#f3f0ff';
        ctx.font = `600 ${n.type === 'category' ? '12px' : '10px'} Outfit, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(n.label, n.x, n.y - radius - 6);
    });
    
    ctx.restore();
}

function renderGraphDetails(node) {
    const container = document.getElementById('graph-details-content');
    container.innerHTML = '';
    
    let typeLabel = node.type.toUpperCase();
    let contentHtml = `
        <div class="inspect-title">${node.label}</div>
        <div class="inspect-row">
            <div class="inspect-label">Node Type</div>
            <div class="inspect-val"><span class="badge ${node.type === 'document' ? 'proj' : (node.type === 'skill' ? 'skill' : 'ach')}">${typeLabel}</span></div>
        </div>
    `;
    
    if (node.type === 'document') {
        // Find matching document detail
        const docId = node.id.replace('doc-', '');
        const doc = documents.find(d => d.id === docId);
        
        if (doc) {
            contentHtml += `
                <div class="inspect-row">
                    <div class="inspect-label">Metadata Category</div>
                    <div class="inspect-val">${doc.category}</div>
                </div>
                <div class="inspect-row">
                    <div class="inspect-label">Hosting Organization</div>
                    <div class="inspect-val">${doc.organization || 'Unknown'}</div>
                </div>
                <div class="inspect-row">
                    <div class="inspect-label">Chronology Year</div>
                    <div class="inspect-val">${doc.year || 'Not specified'}</div>
                </div>
                <div class="inspect-row">
                    <div class="inspect-label">Connected Skills</div>
                    <div class="skill-chips">${doc.skills.map(sk => `<span class="skill-chip">${sk}</span>`).join(' ')}</div>
                </div>
            `;
        }
    } else if (node.type === 'skill') {
        // Find connected documents that share this skill
        const connectedDocs = documents.filter(d => d.skills.includes(node.label));
        contentHtml += `
            <div class="inspect-row">
                <div class="inspect-label">Supporting Evidence Files</div>
                <ul style="padding-left: 20px; font-size: 0.85rem; line-height: 1.6; color: var(--text-secondary);">
                    ${connectedDocs.map(d => `<li>${d.title} (${d.category})</li>`).join('')}
                </ul>
            </div>
        `;
    } else if (node.type === 'category') {
        const count = documents.filter(d => d.category === node.label).length;
        contentHtml += `
            <div class="inspect-row">
                <div class="inspect-label">Items Mapped</div>
                <div class="inspect-val">${count} Documents</div>
            </div>
        `;
    }
    
    container.innerHTML = contentHtml;
}

// --- Search & Chat Assistant Components ---
function initSearchAndChat() {
    // 1. Tabbed Search
    const searchInput = document.getElementById('semantic-search-input');
    const searchBtn = document.getElementById('semantic-search-btn');
    
    searchBtn.addEventListener('click', () => performSemanticSearch(searchInput.value));
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') performSemanticSearch(searchInput.value);
    });

    // 2. Tabbed Chat
    const chatInput = document.getElementById('chat-input');
    const chatSendBtn = document.getElementById('chat-send-btn');
    
    chatSendBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });

    // Bind suggested queries
    document.querySelectorAll('.suggested-query').forEach(q => {
        q.addEventListener('click', (e) => {
            e.preventDefault();
            const text = q.innerText;
            chatInput.value = text;
            sendChatMessage();
        });
    });

    // 3. Global Header Search Input redirects to Chat Tab and performs search
    const globalSearchInput = document.getElementById('global-search-input');
    globalSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && globalSearchInput.value.trim() !== '') {
            const query = globalSearchInput.value;
            switchTab('chat');
            document.getElementById('semantic-search-input').value = query;
            performSemanticSearch(query);
            globalSearchInput.value = '';
        }
    });
}

async function performSemanticSearch(query) {
    if (!query.trim()) return;
    const resultsContainer = document.getElementById('search-results-container');
    resultsContainer.innerHTML = `<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i><p>Querying local vector database...</p></div>`;
    
    try {
        const res = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query })
        });
        
        const data = await res.json();
        resultsContainer.innerHTML = '';
        
        if (data.length === 0) {
            resultsContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-face-frown"></i>
                    <p>No matches found in vector index above the score threshold.</p>
                </div>
            `;
            return;
        }
        
        data.forEach(item => {
            const card = document.createElement('div');
            card.className = 'search-res-card';
            card.innerHTML = `
                <div class="search-res-header">
                    <span class="search-res-title"><i class="fa-regular fa-file"></i> ${item.title}</span>
                    <span class="search-res-score">${Math.round(item.score * 100)}% Match</span>
                </div>
                <div class="search-res-snippet">"${item.text}"</div>
            `;
            resultsContainer.appendChild(card);
        });
    } catch (err) {
        console.error("Search error:", err);
        resultsContainer.innerHTML = `<p style="color: var(--magenta);">Error executing vector query.</p>`;
    }
}

async function sendChatMessage() {
    const chatInput = document.getElementById('chat-input');
    const msgText = chatInput.value.trim();
    if (!msgText) return;
    
    chatInput.value = '';
    
    // Append User Bubble
    appendMessageBubble('user', msgText);
    
    // Append loading bubble for AI
    const loadingId = 'ai-loading-' + Date.now();
    appendMessageBubble('assistant', '<i class="fa-solid fa-circle-notch fa-spin"></i> Synthesizing response...', loadingId);
    
    // Scroll to bottom
    const chatBox = document.getElementById('chat-messages-box');
    chatBox.scrollTop = chatBox.scrollHeight;
    
    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msgText })
        });
        
        const data = await res.json();
        
        // Remove loading bubble and append actual response
        const loadingBubble = document.getElementById(loadingId);
        if (loadingBubble) loadingBubble.remove();
        
        appendMessageBubble('assistant', formatMarkdown(data.answer));
        chatBox.scrollTop = chatBox.scrollHeight;
        
    } catch (err) {
        console.error("Chat error:", err);
        const loadingBubble = document.getElementById(loadingId);
        if (loadingBubble) loadingBubble.remove();
        appendMessageBubble('assistant', 'Sorry, I encountered an error searching your repository records.');
    }
}

function appendMessageBubble(sender, content, id = '') {
    const chatBox = document.getElementById('chat-messages-box');
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg ${sender}`;
    if (id) msgDiv.id = id;
    
    const avatarIcon = sender === 'assistant' ? 'fa-brain-circuit' : 'fa-user-astronaut';
    
    msgDiv.innerHTML = `
        <div class="msg-avatar">
            <i class="fa-solid ${avatarIcon}"></i>
        </div>
        <div class="msg-content">${content}</div>
    `;
    
    chatBox.appendChild(msgDiv);
}

// Simple Markdown Formatter for Assistant Responses
function formatMarkdown(text) {
    let formatted = text;
    // Format bold headers
    formatted = formatted.replace(/^### (.*$)/gim, '<h4>$1</h4>');
    // Format lists
    formatted = formatted.replace(/^\* (.*$)/gim, '<li>$1</li>');
    formatted = formatted.replace(/^- (.*$)/gim, '<li>$1</li>');
    // Wrap consecutive list items in ul
    formatted = formatted.replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>');
    // Simple fix for nested lists
    formatted = formatted.replace(/<\/ul>\s*<ul>/g, '');
    
    // Format bold text
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Format inline code
    formatted = formatted.replace(/`(.*?)`/g, '<code>$1</code>');
    // Format quotes
    formatted = formatted.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');
    // Line breaks
    formatted = formatted.replace(/\n/g, '<br>');
    
    return formatted;
}

// --- OpenAI Realtime Voice WebRTC Logic ---
let peerConnection = null;
let dataChannel = null;

async function startVoiceAssistant() {
    const btn = document.getElementById('voice-assist-btn');
    if (peerConnection) {
        // Disconnect
        peerConnection.close();
        peerConnection = null;
        btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
        appendMessageBubble("assistant", "Voice session ended.");
        return;
    }

    try {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        
        // 1. Get Token from our Python backend
        const tokenResp = await fetch('/api/realtime-token');
        if (!tokenResp.ok) throw new Error("Failed to get realtime token. Is OPENAI_API_KEY set?");
        const tokenData = await tokenResp.json();
        const client_secret = tokenData.client_secret.value;

        // 2. Initialize WebRTC Peer Connection
        peerConnection = new RTCPeerConnection();

        // 3. Audio setup
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        peerConnection.ontrack = e => { audioEl.srcObject = e.streams[0]; };

        const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
        peerConnection.addTrack(ms.getTracks()[0]);

        // 4. Data channel for events
        dataChannel = peerConnection.createDataChannel("oai-events");
        dataChannel.addEventListener("message", (e) => {
            const msg = JSON.parse(e.data);
            if (msg.type === "response.done" && msg.response.output) {
                console.log("OpenAI Event:", msg);
            }
        });

        // 5. Offer / Answer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        const baseUrl = "https://api.openai.com/v1/realtime";
        const model = "gpt-4o-realtime-preview-2024-10-01";
        const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
            method: "POST",
            body: offer.sdp,
            headers: {
                Authorization: `Bearer ${client_secret}`,
                "Content-Type": "application/sdp"
            }
        });
        
        if (!sdpResponse.ok) throw new Error("SDP negotiation failed.");

        const answer = { type: 'answer', sdp: await sdpResponse.text() };
        await peerConnection.setRemoteDescription(answer);

        btn.innerHTML = '<i class="fa-solid fa-stop"></i>';
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-primary');
        appendMessageBubble("assistant", "🎙️ **Voice session active.** I'm listening...");

        // Send an initial event to set system instructions
        dataChannel.addEventListener("open", () => {
            const instructions = {
                type: "session.update",
                session: {
                    instructions: "You are the MemoryVerse AI assistant. Answer questions concisely and professionally."
                }
            };
            dataChannel.send(JSON.stringify(instructions));
        });

    } catch (err) {
        console.error(err);
        btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
        appendMessageBubble("assistant", "Error starting voice session: " + err.message);
    }
}

// Bind the button event if it exists
document.addEventListener("DOMContentLoaded", () => {
    const voiceBtn = document.getElementById("voice-assist-btn");
    if (voiceBtn) {
        voiceBtn.addEventListener("click", startVoiceAssistant);
    }
});
