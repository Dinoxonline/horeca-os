import Link from "next/link";
import styles from "./legal-page.module.css";

export default function LegalPage({ title, intro, children }) {
  return <main className={styles.page}>
    <article className={styles.document}>
      <header><Link href="/" className={styles.brand}>Horeca OS</Link><p>Juridische informatie</p></header>
      <h1>{title}</h1>
      <p className={styles.intro}>{intro}</p>
      <div className={styles.content}>{children}</div>
      <footer>
        <Link href="/privacy">Privacybeleid</Link>
        <Link href="/voorwaarden">Gebruiksvoorwaarden</Link>
        <Link href="/gegevens-verwijderen">Gegevens verwijderen</Link>
      </footer>
    </article>
  </main>;
}

