import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";
import { get_app_url, get_site_name, get_site_tagline } from "@/lib/security/env";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-manrope",
});

const site_url = get_app_url();
const site_name = get_site_name();
const site_description = get_site_tagline();

export const metadata: Metadata = {
  metadataBase: new URL(site_url),
  title: {
    default: `${site_name} — напитки и продукты оптом`,
    template: `%s · ${site_name}`,
  },
  description: site_description,
  applicationName: site_name,
  openGraph: {
    type: "website",
    locale: "ru_RU",
    url: site_url,
    siteName: site_name,
    title: `${site_name} — напитки и продукты оптом`,
    description: site_description,
  },
  twitter: {
    card: "summary_large_image",
    title: `${site_name} — напитки и продукты оптом`,
    description: site_description,
  },
  robots: {
    index: true,
    follow: true,
  },
};

const json_ld = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: site_name,
  url: site_url,
  description: site_description,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(json_ld) }}
        />
      </head>
      <body className={`${manrope.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
