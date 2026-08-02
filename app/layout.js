import "./globals.css";
import "./modules.css";

export const metadata = {
  title: "Horeca OS",
  description: "Managementplatform voor Caribbean Corner en Grandcafé Het Plein",
};

export default function RootLayout({ children }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
