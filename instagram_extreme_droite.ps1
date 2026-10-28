# Liste les comptes Instagram (partis, médias, personnalités) que Wikidata rattache à l'extrême droite française.
# Source : Wikidata (P2003 = nom d'utilisateur Instagram). Aucun appel à Instagram.
# Usage : pwsh .\instagram_extreme_droite.ps1 [-Out comptes.csv]

param([string]$Out = "comptes_instagram_extreme_droite.csv")

$ErrorActionPreference = "Stop"

# Q204481 extrémisme de droite, Q127869500 extrême droite, Q3062653 extrême droite en France, Q21848959 droite radicale
$far = "wd:Q204481 wd:Q127869500 wd:Q3062653 wd:Q21848959"
$france = "{ ?item wdt:P17 wd:Q142 } UNION { ?item wdt:P27 wd:Q142 } UNION { ?item wdt:P495 wd:Q142 }"

function Invoke-Sparql([string]$q) {
    $r = Invoke-RestMethod -Uri "https://query.wikidata.org/sparql" -Method Post `
        -Body @{ query = $q; format = "json" } `
        -Headers @{ "User-Agent" = "instagram-extreme-droite-script/1.0 (recherche)" } -TimeoutSec 80
    $r.results.bindings
}

# 1) Entités classées directement à l'extrême droite (partis, médias, personnes...)
$direct = Invoke-Sparql @"
SELECT ?item ?itemLabel ?insta ?typeLabel WHERE {
  VALUES ?far { $far }
  { ?item wdt:P1387 ?far } UNION { ?item wdt:P1142 ?far }
  $france
  ?item wdt:P2003 ?insta .
  OPTIONAL { ?item wdt:P31 ?type }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
}
"@

# 2) Membres des partis classés à l'extrême droite (ex. Le Pen, Bardella)
$members = Invoke-Sparql @"
SELECT ?item ?itemLabel ?insta ?partyLabel WHERE {
  VALUES ?far { $far }
  ?party wdt:P1387|wdt:P1142 ?far .
  ?party wdt:P17|wdt:P495 wd:Q142 .
  ?item wdt:P102 ?party .
  ?item wdt:P2003 ?insta .
  FILTER NOT EXISTS { ?item wdt:P582 [] }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
}
"@

$byId = @{}
function Add-Row($b, [string]$type, [string]$party) {
    $id = $b.item.value
    if (-not $byId.ContainsKey($id)) {
        $byId[$id] = [pscustomobject]@{
            Nom       = $b.itemLabel.value
            Instagram = "https://www.instagram.com/$($b.insta.value)/"
            Type      = [System.Collections.Generic.SortedSet[string]]::new()
            Classement = [System.Collections.Generic.SortedSet[string]]::new()
            Wikidata  = $id
        }
    }
    if ($type)  { [void]$byId[$id].Type.Add($type) }
    [void]$byId[$id].Classement.Add($party)
}
foreach ($b in $direct)  { Add-Row $b $b.typeLabel.value "classé directement" }
foreach ($b in $members) { Add-Row $b "" ("membre : " + $b.partyLabel.value) }

$rows = $byId.Values | Sort-Object Nom | ForEach-Object {
    $_.Type = $_.Type -join " / "; $_.Classement = $_.Classement -join " | "; $_
}

$rows | Export-Csv -Path $Out -NoTypeInformation -Encoding UTF8
$rows | Format-Table Nom, Instagram, Type, Classement -AutoSize
Write-Host "$($rows.Count) comptes exportés dans $Out"
