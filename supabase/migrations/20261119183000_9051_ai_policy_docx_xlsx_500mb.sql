-- manifest: amplia o bucket ai-policy para aceitar docx, xlsx e limite de 500MB para documentos da base de conhecimento
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'text/markdown',
  'text/x-markdown',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
],
file_size_limit = 524288000
where id = 'ai-policy';
