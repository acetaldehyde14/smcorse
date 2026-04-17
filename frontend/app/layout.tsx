import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SM CORSE | iRacing Endurance Team',
  description: 'SM CORSE iRacing endurance racing team platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
