# Jak připravit profil pro MakAI

## Profil bez přípravy souboru

V aplikaci lze zvolit **Vytvořit profil s AI**. Vyplňte dotazník, nechte OpenAI sestavit návrh, zkontrolujte a upravte jej a pak ho aktivujte pro hledání. Pro tuto cestu nemusíte připravovat JSON ani Markdown. Generování vyžaduje nastavený OpenAI API klíč a dostupný API kredit.

## Který formát zvolit

| Formát | Lze nahrát? | Vhodné použití |
| --- | --- | --- |
| `.md` (Markdown) | Ano | Doporučená varianta: strukturované preference + podrobný profesní kontext. |
| `.json` | Ano | Samotné strukturované preference, role a dovednosti. |
| `.docx`, `.pdf`, `.txt` | Ne | Z těchto souborů přepište podstatné údaje do šablony `.md` nebo `.json`. |

Soubor uložte jako UTF-8, maximálně 250 kB. Přepsání přípony `.docx` na `.md` soubor nepřevede.

## Postup

1. Stáhněte `candidate-profile-template.md` nebo `candidate-profile-template.json`.
2. Nahraďte všechny ukázkové hodnoty vlastními údaji. Vzor představuje smyšlený profil účetního; mzdy, lokalita a dovednosti nejsou doporučením ani údaji současného uživatele.
3. Zachovejte názvy polí. V Markdownu ponechte právě jeden blok označený `json` mezi trojitými zpětnými apostrofy. Další části pod ním vyplňte běžným textem.
4. Uložte soubor jako `.md` nebo `.json` v UTF-8.
5. V aplikaci klikněte na **Nahrát jiný profil**. Po úspěšném načtení zkontrolujte shrnutí a rozbalte celý profil.
6. Pak zvolte **Hledat podle profilu**.

Při neplatném importu se aktivní profil nezmění. Návrat přes **Použít můj výchozí profil** obnoví profil projektu.

## Jak vyplnit strukturovanou část

Seznamy mají tvar `["První položka", "Druhá položka"]`. Pokud nemáte další požadavky, použijte `[]`; nevynechávejte povinné pole. V `target_roles` musí být alespoň jedna skutečná cílová role. Český i anglický název může rozšířit vyhledávání.

| Pole | Co vyplnit |
| --- | --- |
| `target_roles` | Pozice, které chcete hledat. Tyto názvy tvoří vyhledávací dotazy. |
| `skills` | Skutečné dovednosti; popište úroveň nebo míru zkušeností. |
| `working_style` | Jak chcete pracovat: samostatně, v týmu, prakticky, analyticky apod. |
| `preferences` | Typ firmy, kultura, pracovní podmínky a kariérní priority. |
| `no_go_criteria` | Skutečně nepřijatelné podmínky. Méně preferované věci patří do `preferences`. |
| `location_preferences` | Města, dojíždění, relokace, kancelář, hybrid či remote. |
| `language_preferences` | Použitelné jazyky, doložená úroveň a přijatelné komunikační situace. |
| `salary` | Mzdové hranice podle vysvětlení níže. |
| `evidence_limitations` | Co není doložené, co je odhad a co je třeba ověřit. Ukázkové upozornění nahraďte vlastními nejistotami. |

V JSON používejte dvojité uvozovky. Nepřidávejte komentáře, čárku za poslední položkou ani nová pole jako `name`, `experience` nebo `education`. Podrobné zkušenosti a vzdělání doplňte do textové části Markdownu. Pole `profile_markdown`, `cv_source` a `approved_cv_highlights` aplikace spravuje zvlášť a do importovaných preferencí nepatří.

## Mzdové hranice

Všechny částky jsou nezáporná celá čísla v Kč za měsíc hrubého, bez mezer a bez textu „Kč“.

| Pole v `salary` | Význam |
| --- | --- |
| `monthly_gross_target_czk` | Dvě částky `[dolní cíl, horní cíl]`. |
| `exceptional_minimum_czk` | Nejnižší přijatelná mzda pouze pro výjimečnou příležitost. |
| `standard_minimum_czk` | Běžné minimum. |
| `interesting_minimum_czk` | Částka, od které je nabídka finančně zajímavá. |
| `long_term_target_czk` | Volitelný dlouhodobý mzdový cíl; neznámý údaj může být `null`. |
| `long_term_horizon_years` | Volitelný horizont dlouhodobého cíle; celé číslo alespoň 1 nebo `null`, není-li zadán. |
| `historical_fixed_monthly_czk` | Volitelná dosavadní fixní mzda. Pokud ji nechcete uvádět, použijte `null` nebo pole vynechte. |
| `notes` | Jak posuzovat fix, bonusy a případné kompromisy. |

Pořadí musí být: **výjimečné minimum ≤ běžné minimum ≤ zajímavé minimum ≤ dolní cíl ≤ horní cíl**.

## Podrobný kontext v Markdownu

Pod JSON blokem popište profesní shrnutí, skutečná zaměstnání, projekty, vzdělání, kariérní směr a omezení. Odlišujte vlastní znalosti od technologií, s nimiž jste se jen setkali. Nezaměňujte prototyp za produkční nasazení a neuvádějte nepodložené úspory. Závorky `[DOPLŇTE: …]` v šabloně nahraďte textem nebo celou nevyužitou část odstraňte.

Tyto informace pomáhají při hodnocení shody. Import profilu nenahrává ani neověřuje CV. Jiný uživatel nepřebírá CV podklady, historii přihlášek ani kariérní reference výchozího kandidáta.
