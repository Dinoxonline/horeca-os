import LegalPage from "../../components/legal-page";

export const metadata = { title: "Gegevens verwijderen | Horeca OS" };

export default function DeleteDataPage() {
  return <LegalPage title="Gegevens verwijderen" intro="Je kunt de toegang van een extern platform intrekken en verzoeken om de bijbehorende gegevens uit Horeca OS te verwijderen.">
    <h2>Verwijderverzoek indienen</h2>
    <p>Stuur een e-mail naar <a href="mailto:info@caribbeancorner.nl?subject=Verzoek%20gegevensverwijdering%20Horeca%20OS">info@caribbeancorner.nl</a> met als onderwerp <strong>Verzoek gegevensverwijdering Horeca OS</strong>.</p>
    <p>Vermeld het e-mailadres van je Horeca OS-account, de bedrijfsnaam en welke koppeling of gegevens je wilt laten verwijderen. Stuur nooit wachtwoorden, toegangstokens of andere geheime sleutels mee.</p>
    <h2>Identiteitscontrole</h2><p>Om misbruik te voorkomen kunnen wij vragen het verzoek te bevestigen via het geregistreerde e-mailadres of via een bevoegde beheerder van de betreffende vestiging.</p>
    <h2>Afhandeling</h2><p>Na verificatie wordt de koppeling ingetrokken en worden opgeslagen toegangstokens en verwijderbare persoonsgegevens gewist. Wettelijk verplichte administratie en beveiligingslogs kunnen gedurende de toepasselijke bewaartermijn worden behouden.</p>
    <h2>Ook bij het platform ontkoppelen</h2><p>Je kunt Horeca OS daarnaast verwijderen uit de instellingen van het gekoppelde Meta-, Google- of TikTok-account. Daarmee stopt toekomstige toegang door Horeca OS.</p>
  </LegalPage>;
}

