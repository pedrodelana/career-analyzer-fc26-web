import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from main import convert_image

class ImagesTest(unittest.TestCase):
    def test_supported_formats_convert_without_touching_source(self):
        root=Path(__file__).resolve().parents[2]/'.tools'/'test-data'
        root.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root) as folder:
            folder=Path(folder)
            for extension in ['dds','png','jpg','webp']:
                with self.subTest(extension=extension):
                    source=folder/f'portrait.{extension}'
                    Image.new('RGB',(32,48),(50,100,150)).save(source)
                    before=source.read_bytes()
                    output=folder/f'converted-{extension}.webp'
                    convert_image(source,output)
                    self.assertEqual(before,source.read_bytes())
                    with Image.open(output) as result:
                        self.assertEqual(result.format,'WEBP')
                        self.assertEqual(result.size,(32,48))
                    self.assertTrue(output.with_suffix('.png').is_file())

    def test_fake_image_is_rejected(self):
        root=Path(__file__).resolve().parents[2]/'.tools'/'test-data'
        root.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root) as folder:
            source=Path(folder)/'fake.png'
            source.write_text('not an image')
            with self.assertRaises(Exception):
                convert_image(source,Path(folder)/'output.webp')
