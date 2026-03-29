from PIL import Image


def pad_icon(path):
    img = Image.open(path).convert("RGBA")
    w, h = img.size

    # Force square canvas without shrinking the logo itself
    max_dim = max(w, h)

    # Create empty square canvas
    canvas = Image.new("RGBA", (max_dim, max_dim), (0, 0, 0, 0))

    # Paste centered
    x_offset = (max_dim - w) // 2
    y_offset = (max_dim - h) // 2
    canvas.paste(img, (x_offset, y_offset), img)

    canvas.save(path)
    print(f"Padded {path} successfully")


pad_icon("src-tauri/icons/icon.png")
pad_icon("public/icon.png")
