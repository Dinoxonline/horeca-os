import LegalPage from "../../components/legal-page";

export const metadata = { title: "Privacybeleid | Horeca OS" };

export default function PrivacyPage() {
  return <LegalPage title="Privacybeleid" intro="Dit beleid beschrijft hoe Horeca OS persoonsgegevens verwerkt bij het gebruik van het managementplatform en gekoppelde bedrijfsaccounts.">
    <p><strong>Laatst bijgewerkt:</strong> 7 augustus 2026</p>
    <h2>1. Verantwoordelijke</h2>
    <p>Le Club BBQ Restaurant beheert Horeca OS voor de aangesloten horecabedrijven. Vragen over privacy kunnen worden gestuurd naar <a href="mailto:info@caribbeancorner.nl">info@caribbeancorner.nl</a>.</p>
    <h2>2. Welke gegevens worden verwerkt</h2>
    <ul><li>accountgegevens, naam, e-mailadres, rol en vestigingstoegang;</li><li>operationele bedrijfsgegevens die een bevoegde gebruiker invoert of importeert;</li><li>technische log- en beveiligingsgegevens;</li><li>gegevens uit gekoppelde diensten, uitsluitend na toestemming van de beheerder.</li></ul>
    <h2>3. Doeleinden</h2>
    <p>De gegevens worden gebruikt voor authenticatie, toegangsbeheer, bedrijfsvoering, rapportage, het beantwoorden van reviews, het voorbereiden of publiceren van content en het beveiligen en verbeteren van Horeca OS.</p>
    <h2>4. Gekoppelde platformen</h2>
    <p>Een beheerder kan externe bedrijfsaccounts koppelen, waaronder Meta, Instagram, Facebook, Google Business Profile en TikTok. Horeca OS gebruikt alleen de verleende rechten en houdt accounts van afzonderlijke bedrijven gescheiden.</p>
    <h2>5. Bewaring en beveiliging</h2>
    <p>Gegevens worden niet langer bewaard dan noodzakelijk. Toegangstokens worden versleuteld en zijn alleen beschikbaar voor serverprocessen. Toegang wordt beperkt met rollen, vestigingstoegang en aanvullende beveiligingscontroles.</p>
    <h2>6. Delen en doorgifte</h2>
    <p>Gegevens worden alleen gedeeld met dienstverleners die nodig zijn voor de werking van Horeca OS of wanneer de wet dat vereist. Horeca OS verkoopt geen persoonsgegevens.</p>
    <h2>7. Rechten</h2>
    <p>Betrokkenen kunnen verzoeken om inzage, correctie, verwijdering, beperking of overdracht. Een verzoek kan worden ingediend via de pagina Gegevens verwijderen of per e-mail.</p>
  </LegalPage>;
}

