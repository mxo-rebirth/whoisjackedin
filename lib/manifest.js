// The site as an app. An app installed from the private version starts at its own code, so it keeps the
// characters without a cookie: phones keep a home-screen app's cookies apart from the browser's.
export function manifest(code = null) {
  return {
    id: '/',
    name: 'Who is jacked in: MxO Server Stats',
    short_name: 'Jacked in',
    description: 'Live player counts for The Matrix Online community servers.',
    start_url: code ? `/${code}` : '/',
    scope: '/',
    display: 'standalone',
    background_color: '#030604',
    theme_color: '#030604',
    icons: [
      { src: '/assets/icons/app-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/assets/icons/app-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/assets/icons/app-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
