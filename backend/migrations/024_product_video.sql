-- Optional short video on a commodity page. The file is a static asset of the website
-- (served by Nginx, which supports the range requests Safari needs to play MP4).

ALTER TABLE website_products ADD COLUMN video_url VARCHAR(255) NULL;
ALTER TABLE website_products ADD COLUMN video_poster_url VARCHAR(255) NULL;

UPDATE website_products
SET video_url = '/media/cashew-nuts.mp4', video_poster_url = '/media/cashew-nuts-poster.jpg'
WHERE slug = 'cashew-nuts' AND video_url IS NULL;
