from PIL import Image
import os

ico_file = 'ico/ico256.ico'

if os.path.exists(ico_file):
    try:
        img = Image.open(ico_file)
        print(f'ICO 文件: {ico_file}')
        print(f'文件大小: {os.path.getsize(ico_file)} bytes')
        
        # 获取所有帧（尺寸）
        frames = []
        try:
            while True:
                frames.append(img.size)
                img.seek(img.tell() + 1)
        except EOFError:
            pass
        
        print(f'\n包含的尺寸:')
        for i, size in enumerate(frames):
            print(f'  [{i+1}] {size[0]}x{size[1]}')
        
        print(f'\n总计: {len(frames)} 个尺寸')
        
    except Exception as e:
        print(f'错误: {e}')
else:
    print(f'文件不存在: {ico_file}')
