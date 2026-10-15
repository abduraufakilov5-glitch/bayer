-- Read-only preflight against a restored staging copy first. Never contains credentials.
select conrelid::regclass as referencing_table,conname,pg_get_constraintdef(oid)
from pg_constraint where confrelid='public.buyer_catalog_products'::regclass;
select count(*) as order_products, count(*) filter(where p.image_path is null or p.image_path='') as missing_paths,
 count(*) filter(where p.catalog_product_id is not null and c.id is null) as broken_catalog_refs
from public.buyer_products p left join public.buyer_catalog_products c on c.id=p.catalog_product_id;
select count(*) as missing_storage_objects from public.buyer_products p
where not exists(select 1 from storage.objects s where s.bucket_id='buyer-product-images' and s.name=p.image_path);
select image_path,count(distinct order_id) as order_references from public.buyer_products group by image_path having count(distinct order_id)>1;
select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies
where tablename like 'buyer_%' or (schemaname='storage' and (qual like '%buyer-product-images%' or with_check like '%buyer-product-images%'));
