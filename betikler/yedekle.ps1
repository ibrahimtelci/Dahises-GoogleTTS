# tts-merkez yedekleme.
#
#   powershell -ExecutionPolicy Bypass -File betikler\yedekle.ps1
#   powershell -ExecutionPolicy Bypass -File betikler\yedekle.ps1 -HedefDizin D:\yedek
#
# NEDEN: Ses yeniden üretilebilir (Google'a tekrar gidilir, karakter maliyeti
# ödenir). Ama KELİME LİSTESİ ve hangi klibin var olduğu bilgisi yeri
# doldurulamaz — o veri hastane trafiğinden birikti, tekrar üretilemez.
# Bu yüzden veritabanı yedeği banka dizininden daha kritiktir.

param(
    [string]$HedefDizin = "$PSScriptRoot\..\yedek",
    [int]$SaklamaGunu = 30,
    [switch]$BankayiAtla
)

$ErrorActionPreference = 'Stop'

$PgDump = 'C:\Program Files\PostgreSQL\18\bin\pg_dump.exe'
$KokDizin = Resolve-Path "$PSScriptRoot\.."
$Damga = Get-Date -Format 'yyyy-MM-dd_HHmmss'

if (-not (Test-Path $HedefDizin)) { New-Item -ItemType Directory -Force -Path $HedefDizin | Out-Null }
$HedefDizin = (Resolve-Path $HedefDizin).Path

# ── .env oku ──────────────────────────────────────────────────────────────
$EnvYolu = Join-Path $KokDizin '.env'
if (-not (Test-Path $EnvYolu)) { throw ".env bulunamadi: $EnvYolu" }

$Ayarlar = @{}
foreach ($satir in Get-Content $EnvYolu -Encoding UTF8) {
    if ($satir -match '^\s*#') { continue }
    if ($satir -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { $Ayarlar[$Matches[1]] = $Matches[2].Trim() }
}

$Veritabani = $Ayarlar['PGDATABASE']
if (-not $Veritabani) { $Veritabani = 'ttsmerkez' }

# ── 1. Veritabanı ─────────────────────────────────────────────────────────
Write-Host "[1/3] pg_dump -> $Veritabani"

if (-not (Test-Path $PgDump)) { throw "pg_dump bulunamadi: $PgDump" }

$env:PGPASSWORD = $Ayarlar['PGPASSWORD']
$DumpDosyasi = Join-Path $HedefDizin "ttsmerkez_$Damga.dump"

# -Fc: sıkıştırılmış özel biçim; pg_restore ile seçmeli geri yükleme yapılabilir.
& $PgDump -h $Ayarlar['PGHOST'] -p $Ayarlar['PGPORT'] -U $Ayarlar['PGUSER'] `
          -d $Veritabani -Fc -f $DumpDosyasi
if ($LASTEXITCODE -ne 0) { throw "pg_dump basarisiz (cikis $LASTEXITCODE)" }
$env:PGPASSWORD = $null

$Boyut = [math]::Round((Get-Item $DumpDosyasi).Length / 1MB, 2)
Write-Host "      $DumpDosyasi ($Boyut MB)"

# ── 2. Banka dizini ───────────────────────────────────────────────────────
if ($BankayiAtla) {
    Write-Host "[2/3] banka arsivi ATLANDI (-BankayiAtla)"
} else {
    $BankaGoreli = $Ayarlar['BANKA_DIZINI']
    if (-not $BankaGoreli) { $BankaGoreli = './veri/banka' }
    $BankaYolu = Join-Path $KokDizin ($BankaGoreli -replace '^\./', '')

    if (Test-Path $BankaYolu) {
        Write-Host "[2/3] banka arsivi -> $BankaYolu"
        $Arsiv = Join-Path $HedefDizin "banka_$Damga.zip"
        Compress-Archive -Path (Join-Path $BankaYolu '*') -DestinationPath $Arsiv -CompressionLevel Optimal
        $BankaBoyut = [math]::Round((Get-Item $Arsiv).Length / 1MB, 2)
        Write-Host "      $Arsiv ($BankaBoyut MB)"
    } else {
        Write-Host "[2/3] banka dizini yok, atlandi: $BankaYolu"
    }
}

# ── 3. Eski yedekleri temizle ─────────────────────────────────────────────
Write-Host "[3/3] $SaklamaGunu gunden eski yedekler siliniyor"
$Sinir = (Get-Date).AddDays(-$SaklamaGunu)
$Silinen = 0
foreach ($d in Get-ChildItem $HedefDizin -File | Where-Object {
        ($_.Name -like 'ttsmerkez_*.dump' -or $_.Name -like 'banka_*.zip') -and $_.LastWriteTime -lt $Sinir }) {
    Remove-Item $d.FullName -Force
    $Silinen++
}
Write-Host "      $Silinen dosya silindi"

Write-Host ""
Write-Host "Yedek tamam: $HedefDizin"
Write-Host ""
Write-Host "Geri yukleme:"
Write-Host "  pg_restore -h 127.0.0.1 -U postgres -d ttsmerkez --clean --if-exists $DumpDosyasi"
Write-Host ""
Write-Host "Gunluk otomatik calistirma (Gorev Zamanlayici):"
Write-Host "  schtasks /Create /SC DAILY /ST 03:00 /TN tts-merkez-yedek ``"
Write-Host "    /TR ""powershell -ExecutionPolicy Bypass -File $PSCommandPath"""
