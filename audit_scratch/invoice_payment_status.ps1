# Print the payment-status prose from each local invoice, verbatim.
# The parser's "Deposit Paid" flag was unreliable (it matched template headings),
# so this shows the actual sentences a human wrote so they can be judged.
param([string[]]$Files)

function Get-InvoiceText($path) {
  $t = Get-Content $path -Raw
  $t = [regex]::Replace($t, '(?s)<style.*?</style>', '')
  $t = [regex]::Replace($t, '(?s)<script.*?</script>', '')
  $t = [regex]::Replace($t, '<[^>]+>', "`n")
  $t = $t -replace '&middot;', '.' -replace '&mdash;', '-' -replace '&ndash;', '-' `
          -replace '&minus;', '-' -replace '&nbsp;', ' ' -replace '&rsquo;', "'" -replace '&amp;', '&'
  ($t -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
}

foreach ($f in Get-ChildItem invoices -Filter *.html | Where-Object { $_.Name -ne '_template.html' }) {
  if ($Files -and ($Files -notcontains $f.BaseName)) { continue }
  $lines = Get-InvoiceText $f.FullName
  "===== $($f.BaseName) ====="
  $lines | Where-Object {
    $_ -match '(?i)deposit|paid|balance|received|due|total|venmo|stripe|zelle|card|reserve'
  } | Select-Object -Unique | Select-Object -First 16
  ""
}
