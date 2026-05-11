import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'open42:utility-panel:hidden';
const CHANGE_EVENT = 'open42:utility-panel:change';

function readHidden(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Shared visibility state for the right-rail UtilityPanel.
 *
 * Persists in localStorage so the user's choice survives reloads. Other tabs
 * stay in sync via the storage event; same-tab toggles broadcast via a custom
 * event since storage events don't fire in the originating tab.
 */
export function useUtilityPanelVisible(): {
  visible: boolean;
  setVisible: (value: boolean) => void;
} {
  // Start hidden=false on the server. Real value is read after mount to avoid
  // SSR/CSR mismatch warnings; pages that mount the panel never render server-
  // side either, so this is safe.
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(readHidden());
    const sync = () => setHidden(readHidden());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setVisible = useCallback((value: boolean) => {
    if (typeof window === 'undefined') return;
    try {
      if (value) {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, 'true');
      }
    } catch {
      // localStorage may be blocked (private browsing); fall through.
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }, []);

  return { visible: !hidden, setVisible };
}
