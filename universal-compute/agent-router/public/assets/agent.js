const qs = new URLSearchParams(location.search);
const face = qs.get('face') || '';

const path = location.pathname.replace(/^\/+/, '');
const agentPath = path === '' ? 'home-agent' : path.split('/')[0];

document.getElementById('agent').textContent = agentPath;
document.getElementById('face').textContent = face || '(missing)';

const facesLink = document.getElementById('faces-link');
// Keep link relative; if on app host, /{agent}/faces; if base, same
facesLink.href = `/${agentPath}/faces`;

// Placeholder: later, attach WS/TTYD here using agentPath + face
console.debug('[agent.js] agentPath=', agentPath, 'face=', face);

// Mount the proxied ttyd in an iframe so we can steer it later
const iframe = document.getElementById('tty-frame');
// We keep the proxy at /tty/, and ttyd will use /ws at the same origin
iframe.src = '/tty/';

