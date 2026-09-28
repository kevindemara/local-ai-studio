param([string]$Destination = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$culture = [Globalization.CultureInfo]::InvariantCulture
$font = [Drawing.FontFamily]::new('Bahnschrift')
$format = [Drawing.StringFormat]::GenericTypographic
$svgFolder = Join-Path $Destination 'svg'
New-Item -ItemType Directory -Path $svgFolder -Force | Out-Null

function Number([float]$Value) { $Value.ToString('0.###', $culture) }

function Outline([string]$Text, [float]$Size, [bool]$Bold = $false) {
    $shape = [Drawing.Drawing2D.GraphicsPath]::new()
    $style = if ($Bold) { [Drawing.FontStyle]::Bold } else { [Drawing.FontStyle]::Regular }
    $shape.AddString($Text, $font, [int]$style, $Size, [Drawing.PointF]::new(0, 0), $format)
    $bounds = $shape.GetBounds()
    $points = $shape.PathPoints
    $types = $shape.PathTypes
    $commands = [Text.StringBuilder]::new()
    for ($i = 0; $i -lt $points.Length; $i++) {
        $type = $types[$i] -band 7
        switch ($type) {
            0 { [void]$commands.Append("M$(Number $points[$i].X) $(Number $points[$i].Y)") }
            1 { [void]$commands.Append("L$(Number $points[$i].X) $(Number $points[$i].Y)") }
            3 {
                [void]$commands.Append("C$(Number $points[$i].X) $(Number $points[$i].Y) $(Number $points[$i+1].X) $(Number $points[$i+1].Y) $(Number $points[$i+2].X) $(Number $points[$i+2].Y)")
                $i += 2
            }
            default { throw "Unsupported outline segment: $type" }
        }
        if ($types[$i] -band 128) { [void]$commands.Append('Z') }
    }
    $result = @{ D = $commands.ToString(); X = $bounds.X; Y = $bounds.Y; Width = $bounds.Width; Height = $bounds.Height }
    $shape.Dispose()
    return $result
}

function TextPath([string]$Text, [float]$Size, [float]$X, [float]$Y, [string]$Color, [bool]$Bold = $false) {
    $outline = Outline $Text $Size $Bold
    return "<path fill='$Color' transform='translate($(Number ($X-$outline.X)) $(Number ($Y-$outline.Y)))' d='$($outline.D)'/>"
}

function Mark([string]$Mint, [string]$Violet) {
    return @"
<path fill='$Mint' d='M8 8H20V44H56V56H8Z'/>
<path fill='$Violet' d='M30 8H56V34H46V18H30Z'/>
<path fill='$Violet' d='M33 24L41 32L33 40L25 32Z'/>
"@
}

function SaveSvg([string]$Name, [string]$ViewBox, [string]$Title, [string]$Body) {
    $content = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='$ViewBox' role='img' aria-labelledby='title'><title id='title'>$Title</title>$Body</svg>"
    [IO.File]::WriteAllText((Join-Path $svgFolder $Name), $content, [Text.UTF8Encoding]::new($false))
}

$darkMark = Mark '#A2D8C5' '#C3B2ED'
$lightMark = Mark '#397B68' '#7251A5'
$blackMark = Mark '#191A1E' '#191A1E'
$whiteMark = Mark '#EEEEF2' '#EEEEF2'
SaveSvg 'local-ai-studio-mark.svg' '0 0 64 64' 'Local AI Studio logomark for dark backgrounds' $darkMark
SaveSvg 'local-ai-studio-mark-light.svg' '0 0 64 64' 'Local AI Studio logomark for light backgrounds' $lightMark
SaveSvg 'local-ai-studio-mark-mono.svg' '0 0 64 64' 'Local AI Studio monochrome logomark' $blackMark
SaveSvg 'local-ai-studio-mark-white.svg' '0 0 64 64' 'Local AI Studio white logomark' $whiteMark

$wordmark = Outline 'Local AI Studio' 64 $true
$logoWidth = [Math]::Ceiling(120 + $wordmark.Width + 12)
$wordY = (96 - $wordmark.Height) / 2
$darkText = TextPath 'Local AI Studio' 64 120 $wordY '#EEEEF2' $true
$lightText = TextPath 'Local AI Studio' 64 120 $wordY '#191A1E' $true
$darkLogo = "<g transform='scale(1.5)'>$darkMark</g>$darkText"
$lightLogo = "<g transform='scale(1.5)'>$lightMark</g>$lightText"
$monoLogo = "<g transform='scale(1.5)'>$blackMark</g>$lightText"
$whiteLogo = "<g transform='scale(1.5)'>$whiteMark</g>$darkText"
SaveSvg 'local-ai-studio-logo-dark.svg' "0 0 $logoWidth 96" 'Local AI Studio logo for dark backgrounds' $darkLogo
SaveSvg 'local-ai-studio-logo-light.svg' "0 0 $logoWidth 96" 'Local AI Studio logo for light backgrounds' $lightLogo
SaveSvg 'local-ai-studio-logo-mono.svg' "0 0 $logoWidth 96" 'Local AI Studio monochrome logo' $monoLogo
SaveSvg 'local-ai-studio-logo-white.svg' "0 0 $logoWidth 96" 'Local AI Studio white logo' $whiteLogo

$appIcon = "<rect width='64' height='64' rx='14' fill='#191A1E'/><g transform='translate(4 4) scale(.875)'>$darkMark</g>"
$favicon = "<rect width='64' height='64' rx='14' fill='#191A1E'/>$darkMark"
SaveSvg 'local-ai-studio-app-icon.svg' '0 0 64 64' 'Local AI Studio application icon' $appIcon
SaveSvg 'local-ai-studio-favicon.svg' '0 0 64 64' 'Local AI Studio favicon' $favicon

$logoScale = 1280 / $logoWidth
$logoX = 160
$logoY = 280 - (96 * $logoScale / 2)
$board = @"
<rect width='1600' height='1050' fill='#F5F4F1'/>
<rect width='1600' height='610' fill='#191A1E'/>
$(TextPath 'LOCAL CORE' 21 64 52 '#C3B2ED')
$(TextPath 'Local AI Studio / Identity concept' 19 1210 54 '#9B9BA8')
<g transform='translate($logoX $(Number $logoY)) scale($(Number $logoScale))'>$darkLogo</g>
$(TextPath 'An open workspace. A local core.' 22 64 535 '#9B9BA8')
<g transform='translate(180 685) scale(2.5)'>$lightMark</g>
<g transform='translate(720 685) scale(2.5)'>$blackMark</g>
<g transform='translate(1260 685) scale(2.5)'>$appIcon</g>
$(TextPath 'Logomark' 27 195 884 '#191A1E')
$(TextPath 'Monochrome' 27 727 884 '#191A1E')
$(TextPath 'App icon' 27 1290 884 '#191A1E')
$(TextPath 'MINT / LAVENDER / CHARCOAL' 16 64 1000 '#666670')
$(TextPath 'Outlined SVG + transparent PNG' 16 1250 1000 '#666670')
"@
SaveSvg 'brand-preview.svg' '0 0 1600 1050' 'Local AI Studio Local Core visual identity' $board
$font.Dispose()
$format.Dispose()
Write-Output "Wrote SVG assets to $svgFolder; horizontal logo viewBox: $logoWidth x 96."
