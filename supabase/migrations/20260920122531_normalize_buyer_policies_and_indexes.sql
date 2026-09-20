-- Existing Bayer installations used canonical policy/index names that differ
-- from the original repository migration. Keep one equivalent copy of each.
drop policy if exists products_select_own on public.buyer_products;
drop policy if exists products_insert_own on public.buyer_products;
drop policy if exists products_update_own on public.buyer_products;
drop policy if exists products_delete_own on public.buyer_products;
drop policy if exists submissions_select_own on public.buyer_submissions;
drop policy if exists submission_items_select_own on public.buyer_submission_items;

drop index if exists public.buyer_submission_items_submission_idx;
drop index if exists public.buyer_submission_items_product_idx;
