# PAI Pulse Icon

Place `pulse.ico` in this directory for the Windows system tray icon.

Requirements:
- Multi-resolution ICO file: 16×16, 32×32, 48×48, 256×256 pixels
- The icon should visually represent PAI/Pulse (e.g., a pulse/heartbeat waveform or the PAI logo)

## Generating the icon

If you have the PAI logo SVG, convert it:

```powershell
# Using ImageMagick (if installed):
magick convert pai-logo.svg -resize 256x256 `
  -define icon:auto-resize="256,128,64,48,32,16" `
  pulse.ico
```

Or use an online converter: https://convertio.co/svg-ico/

## Fallback

If `pulse.ico` is missing, the systray icon will use the default application icon.
The tray menu will still function correctly.
