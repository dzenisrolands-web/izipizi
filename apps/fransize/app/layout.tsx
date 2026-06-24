import type { Metadata } from "next";
export const metadata: Metadata = { title: "Franšīzes pārlūks | IziPizi" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="lv">
      <head><link href="https://fonts.googleapis.com/css2?family=Mulish:wght@400;600;700;800&display=swap" rel="stylesheet" /></head>
      <body style={{ fontFamily: '"Mulish", system-ui, sans-serif', margin: 0, background: '#f8fafb' }}>{children}</body>
    </html>
  );
}
