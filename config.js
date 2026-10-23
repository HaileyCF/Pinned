// ============ EDIT THESE THREE LINES ============
const SUPABASE_URL = 'https://pzxvftbirtruyefmhmxc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_dGAMZ4Bgofo1xdPsHU3ITQ_lTWDL-lG';
const SITE_URL = 'https://haileycf.github.io/pinned/';    // where the site lives (keep the trailing slash)
// ================================================

const configured = !SUPABASE_URL.startsWith('PASTE') && !SUPABASE_ANON_KEY.startsWith('PASTE');
const db = configured ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
