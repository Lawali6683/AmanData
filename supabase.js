import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = 'https://pzyxknmysydjbszumptt.supabase.co'
const supabaseKey = 'sb_publishable_T_-kOlpwp0GLGkv0TbMGBA_YiPrL-QI'

export const supabase = createClient(supabaseUrl, supabaseKey)

const PUREDATA_SESSION_KEY = 'puredata_user_session';
const SUPABASE_AUTH_KEY = 'sb-' + new URL(supabaseUrl).hostname.split('.')[0] + '-auth-token';

function readAuthUser() {
    try {
        const raw = localStorage.getItem(SUPABASE_AUTH_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const user = parsed && (parsed.user || (parsed.currentSession && parsed.currentSession.user));
        return user && user.id ? user : null;
    } catch (e) {
        return null;
    }
}

function bridgePureDataSession() {
    try {
        const user = readAuthUser();
        if (!user) return;
        let stored = null;
        try {
            stored = JSON.parse(localStorage.getItem(PUREDATA_SESSION_KEY) || 'null');
        } catch (e) {
            stored = null;
        }
        const storedId = stored && (stored.userId || stored.id);
        if (storedId === user.id) return;
        localStorage.setItem(PUREDATA_SESSION_KEY, JSON.stringify({
            userId: user.id,
            id: user.id,
            email: user.email || ''
        }));
    } catch (e) {}
}

bridgePureDataSession();

try {
    if (!window.__puredataLogoutPatched) {
        window.__puredataLogoutPatched = true;
        const nativeRemoveItem = Storage.prototype.removeItem;
        Storage.prototype.removeItem = function (key) {
            nativeRemoveItem.call(this, key);
            if (this === window.localStorage && key === PUREDATA_SESSION_KEY) {
                nativeRemoveItem.call(this, SUPABASE_AUTH_KEY);
                try {
                    supabase.auth.signOut({ scope: 'local' }).catch(function () {});
                } catch (e) {}
            }
        };
    }
} catch (e) {}

try {
    supabase.auth.onAuthStateChange(function (event) {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') bridgePureDataSession();
    });
} catch (e) {}
