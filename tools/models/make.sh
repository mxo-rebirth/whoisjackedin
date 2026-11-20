#!/bin/sh
# Rebuilds the 3D busts in art/models from a Matrix Online client install.
# Usage: sh tools/models/make.sh "<folder that holds rezmap.lta and packmaps/>"
# Needs python3 and, for shrinking the textures, macOS's sips.
set -e
GAME="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$(mktemp -d)"
MODELS="$HERE/../../art/models"
python3 -I "$HERE/build_models.py" "$GAME" "$OUT" \
  cryptos=resource/characters-NPC/Cryptos/NPCCryptos.moa \
  tyndall:bust:woman=resource/characters-NPC/Contacts/tyndall.moa \
  flood:full:regal=resource/characters-NPC/Flood/Flood.moa \
  lotus=resource/characters-NPC/Contacts/Lotus.moa \
  general=resource/characters-NPC/General-male/NPCM_General.moa \
  chessman=resource/characters-NPC/Contacts/TheChessman.moa \
  weaver=resource/characters-NPC/Contacts/Weaver.moa
rm -rf "$MODELS"; mkdir -p "$MODELS"; cp "$OUT"/*.bin "$MODELS/"
while read file source side; do
  if [ "${file##*.}" = "jpg" ]; then sips -s format jpeg -s formatOptions 78 -Z "$side" "$OUT/textures/$source" --out "$MODELS/$file" >/dev/null
  elif [ "$side" = "0" ]; then cp "$OUT/textures/$source" "$MODELS/$file"
  else sips -Z "$side" "$OUT/textures/$source" --out "$MODELS/$file" >/dev/null; fi
done < "$OUT/textures.txt"
rm -rf "$OUT"
