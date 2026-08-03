from PIL import Image
import os

img_path = r"C:\Users\serge\.gemini\antigravity\brain\9e12d621-662d-4ed0-9e1e-1c89b2f3d867\logo_horizontal_1784241180984.jpg"
output_path = r"d:\YandexDisk\AWG\md_obsidian\_app\client\public\logo_horizontal.png"

try:
    # Load image
    img = Image.open(img_path)
    
    # Convert to grayscale to find the bounding box of non-black pixels
    gray = img.convert("L")
    
    # getbbox() finds the bounding box of non-zero (non-black) pixels
    # We will use a threshold to be safer against compression artifacts
    threshold = 12
    # Apply thresholding: set pixels below threshold to 0, above to 255
    thresh = gray.point(lambda p: 255 if p > threshold else 0)
    
    bbox = thresh.getbbox()
    if bbox:
        left, upper, right, lower = bbox
        
        # Add some padding to look professional
        width, height = img.size
        padding_x = 40
        padding_y = 20
        
        left = max(0, left - padding_x)
        upper = max(0, upper - padding_y)
        right = min(width, right + padding_x)
        lower = min(height, lower + padding_y)
        
        cropped = img.crop((left, upper, right, lower))
        
        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        cropped.save(output_path, "PNG")
        print(f"SUCCESS: Cropped logo from {img.size} to {cropped.size} and saved to {output_path}")
    else:
        print("WARNING: Bounding box not found, saving original with PNG format")
        img.save(output_path, "PNG")
except Exception as e:
    print(f"ERROR: {str(e)}")
