const host = location.host;

const env =
  host.includes('localhost') ? 'local' :
  /hard75-staging\.web\.app|hard75-staging\.firebaseapp\.com/.test(host) ? 'staging' :
  'prod';

const s = document.createElement('script');
s.src = env === 'staging'
  ? './firebase-config.staging.js'
  : './firebase-config.prod.js';
document.head.appendChild(s);