export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL;
    const hadController = Boolean(navigator.serviceWorker.controller);
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    void navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch((error) => {
      console.error("[pwa] service worker registration failed", error);
    });
  });
}
