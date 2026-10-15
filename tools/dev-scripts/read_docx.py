import zipfile
from xml.etree import ElementTree as ET

path = r"d:\电商数据分析可视化与销量预测 京东商品 机器学习 爬虫.docx"
z = zipfile.ZipFile(path)
root = ET.fromstring(z.read("word/document.xml"))
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

out = []
for p in root.iter(W + "p"):
    text = "".join((n.text or "") for n in p.iter(W + "t"))
    if text.strip():
        out.append(text)

print("\n".join(out))