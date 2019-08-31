# Generated by Django 2.2.4 on 2019-08-28 09:08
import json
from django.db import migrations
import zipfile
import tempfile
import os


# from https://stackoverflow.com/questions/25738523/how-to-update-one-file-inside-zip-file-using-python
def update_revision_zip(zipname, citation_styles):
    # generate a temp file
    tmpfd, tmpname = tempfile.mkstemp(dir=os.path.dirname(zipname))
    os.close(tmpfd)
    document_json = False
    # create a temp copy of the archive without filename
    with zipfile.ZipFile(zipname, 'r') as zin:
        with zipfile.ZipFile(tmpname, 'w') as zout:
            zout.comment = zin.comment # preserve the comment
            for item in zin.infolist():
                if item.filename == 'document.json':
                    document_json = json.loads(zin.read(item.filename))
                else:
                    zout.writestr(item, zin.read(item.filename))
    if not document_json:
        return
    document_json['contents']['attrs']['citationstyles'] = citation_styles
    # replace with the temp archive
    os.remove(zipname)
    os.rename(tmpname, zipname)

    # now add filename with its new data
    with zipfile.ZipFile(
        zipname,
        mode='a',
        compression=zipfile.ZIP_DEFLATED
    ) as zf:
        zf.writestr(
            'document.json',
            json.dumps(document_json)
        )


def set_citationstyles(apps, schema_editor):
    DocumentTemplate = apps.get_model('document', 'DocumentTemplate')
    for doc_template in DocumentTemplate.objects.all():
        citation_styles = []
        for style in doc_template.citation_styles.all():
            style_name = style.short_title
            if style_name in [
                'american-anthropological-association',
                'apa',
                'chicago-author-date',
                'chicago-note-bibliography',
                'oxford-university-press-humsoc',
                'nature'
            ]:
                citation_styles.append(style_name)
            elif style_name == 'mla':
                citation_styles.append('modern-language-association')
            elif style_name == 'harvard1':
                citation_styles.append('harvard-cite-them-right')
            else:
                continue
        if len(citation_styles) == 8:
            # includes all styles, which is the default, so we can ignore it.
            continue
        definition = json.loads(doc_template.definition)
        definition['attrs']['citationstyles'] = citation_styles
        doc_template.definition = json.dumps(definition)
        doc_template.save()
        for doc in doc_template.document_set.all():
            contents = json.loads(doc.contents)
            contents['attrs']['citationstyles'] = citation_styles
            doc.contents = json.dumps(contents)
            doc.save()
            for revision in doc.documentrevision_set.all():
                update_revision_zip(
                    revision.file_object.path,
                    citation_styles
                )
        print('applied change')


class Migration(migrations.Migration):

    dependencies = [
        ('document', '0014_auto_20190811_1204'),
    ]

    operations = [
        migrations.RunPython(set_citationstyles),
    ]
