from PIL import Image, ImageDraw, ImageFont
import os

icon_path = r"d:\YandexDisk\AWG\md_obsidian\_app\client\public\logo_icon.png"
output_path = r"d:\YandexDisk\AWG\md_obsidian\_app\client\public\logo_horizontal.png"

try:
    # Load the icon
    icon = Image.open(icon_path)
    
    # Resize the icon to 128px height (retaining aspect ratio)
    target_height = 128
    aspect_ratio = icon.width / icon.height
    target_width = int(target_height * aspect_ratio)
    icon_resized = icon.resize((target_width, target_height), Image.Resampling.LANCZOS)
    
    # Select Segoe UI Bold as the font for a modern look (fallback to Arial Bold)
    font_path = r"C:\Windows\Fonts\segoeuib.ttf"
    if not os.path.exists(font_path):
        font_path = r"C:\Windows\Fonts\arialbd.ttf"
        
    font_size = 64
    font = ImageFont.truetype(font_path, font_size)
    
    # Calculate text size using a temporary draw context
    draw_test = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    text_bbox = draw_test.textbbox((0, 0), "STRATANOTE", font=font)
    text_width = text_bbox[2] - text_bbox[0]
    text_height = text_bbox[3] - text_bbox[1]
    
    # Padding settings
    padding_left = 10
    spacing = 24
    padding_right = 30
    
    total_width = target_width + padding_left + spacing + text_width + padding_right
    total_height = target_height
    
    # Create canvas with a fully transparent background (0, 0, 0, 0)
    canvas = Image.new("RGBA", (total_width, total_height), color=(0, 0, 0, 0))
    
    # Paste the icon using itself as an alpha mask if it has an alpha channel
    if icon_resized.mode in ('RGBA', 'LA') or (icon_resized.mode == 'P' and 'transparency' in icon_resized.info):
        canvas.paste(icon_resized, (padding_left, 0), icon_resized)
    else:
        canvas.paste(icon_resized, (padding_left, 0))
        
    # Draw the text in the brand purple color: #8b5cf6 (RGB: 139, 92, 246)
    draw = ImageDraw.Draw(canvas)
    text_y = (total_height - text_height) // 2 - text_bbox[1]
    
    purple_color = (139, 92, 246, 255) # Add 255 alpha for full opacity
    
    draw.text((padding_left + target_width + spacing, text_y), "STRATANOTE", fill=purple_color, font=font)
    
    # Save the file
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    canvas.save(output_path, "PNG")
    print(f"SUCCESS: Combined icon and text with transparent background. Size: {canvas.size}")
except Exception as e:
    print(f"ERROR: {str(e)}")
