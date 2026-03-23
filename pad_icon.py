from PIL import Image
import sys

def pad_icon(path):
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    
    # Calculate new smaller size (e.g. 70%)
    scale = 0.65
    new_w = int(w * scale)
    new_h = int(h * scale)
    
    resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    
    # Create empty canvas of original size
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    
    # Paste centered
    x_offset = (w - new_w) // 2
    y_offset = (h - new_h) // 2
    canvas.paste(resized, (x_offset, y_offset), resized)
    
    canvas.save(path)
    print(f"Padded {path} successfully")

pad_icon('src-tauri/icons/icon.png')
pad_icon('public/icon.png')
