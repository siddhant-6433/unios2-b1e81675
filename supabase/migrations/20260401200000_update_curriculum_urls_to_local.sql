-- Move curriculum_url from Webflow CDN to local self-hosted PDFs
UPDATE courses SET curriculum_url = '/pdfs/curriculum/' || webflow_slug || '.pdf'
WHERE webflow_slug IN (
  'diploma-in-pharmacy',
  'bachelor-of-physiotherapy',
  'bachelor-of-education-kotputli-jaipur',
  'diploma-in-operation-theatre-technology',
  'bachelor-of-education-greater-noida',
  'masters-in-physiotherapy',
  'b-sc-in-radiology-and-imaging-technology',
  'bachelor-of-science-in-nursing',
  'diploma-in-general-nursing-midwifery-gnm',
  'diploma-in-elementary-education-d-el-ed-btc',
  'bachelor-of-arts-bachelor-of-laws-ba-llb-greater-noida',
  'bachelor-of-business-administration-bba',
  'bachelor-of-computer-applications-bca'
) AND curriculum_url IS NOT NULL;
