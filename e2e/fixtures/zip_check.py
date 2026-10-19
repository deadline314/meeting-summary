"""Lists an exported archive and checks the Markdown links to the bundled image by relative path."""
import sys, zipfile, urllib.parse

z = zipfile.ZipFile(sys.argv[1])
names = z.namelist()
print("\n".join(names))
md = [n for n in names if n.endswith(".md")][0]
text = z.read(md).decode("utf-8")
img = [n for n in names if "/images/" in n][0].split("/", 1)[1]
print("MD_LINK_OK" if "](" + urllib.parse.quote(img, safe="/") + ")" in text else "MD_LINK_MISSING")
