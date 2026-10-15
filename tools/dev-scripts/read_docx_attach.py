import zipfile, re, sys
from xml.etree import ElementTree as ET

path = r"D:\微信存储\xwechat_files\wxid_pfr425d67yir12_e3f0\msg\file\2026-10\附件2：关于举办2026年辽宁省大学生企业云服务开发者大赛的通知-525.docx"
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

with zipfile.ZipFile(path) as z:
    xml = z.read('word/document.xml')

root = ET.fromstring(xml)
paragraphs = []
for p in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'):
    texts = [t.text or '' for t in p.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t')]
    line = ''.join(texts)
    paragraphs.append(line)

out = '\n'.join(paragraphs)
print(out)
