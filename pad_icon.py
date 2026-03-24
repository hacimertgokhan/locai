from PIL import Image
import sys

def pad_icon(path):
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    
    # Force square canvas
    max_dim = max(w, h)
    
    # Calculate new smaller size based on max_dim
    scale = 0.75
    new_w = int(w * scale)
    new_h = int(h * scale)
    
    resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    
    # Create empty square canvas
    canvas = Image.new("RGBA", (max_dim, max_dim), (0, 0, 0, 0))
    
    # Paste centered
    x_offset = (max_dim - new_w) // 2
    y_offset = (max_dim - new_h) // 2
    canvas.paste(resized, (x_offset, y_offset), resized)
    
    canvas.save(path)
    print(f"Padded {path} successfully")

pad_icon('src-tauri/icons/icon.png')
pad_icon('public/icon.png')
