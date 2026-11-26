import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Money Tracker',
    short_name: 'Money',
    description: 'Catatan uang masuk dan keluar',
    lang: 'id',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#f4f6f3',
    theme_color: '#173e39',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
