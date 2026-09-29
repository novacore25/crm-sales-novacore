import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CoreDesk - Sales TNT',
  description: 'CRM System for Sales TNT',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
