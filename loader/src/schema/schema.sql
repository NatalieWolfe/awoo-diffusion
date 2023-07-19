CREATE TABLE posts (
  post_id           BIGINT UNSIGNED NOT NULL,
  parent_id         BIGINT UNSIGNED,
  md5               CHAR(32) NOT NULL,
  uploader_id       INT NOT NULL,
  approver_id       INT,
  created_at        DATETIME(6) NOT NULL,
  updated_at        DATETIME(6),
  rating            CHAR(1) NOT NULL,
  image_width       INT UNSIGNED NOT NULL,
  image_height      INT UNSIGNED NOT NULL,
  file_ext          VARCHAR(16) NOT NULL,
  file_size         BIGINT UNSIGNED NOT NULL,
  comment_count     INT UNSIGNED NOT NULL,
  description       LONGTEXT NOT NULL,
  duration          DOUBLE,
  score             INT NOT NULL,
  up_score          INT UNSIGNED NOT NULL,
  down_score        INT UNSIGNED NOT NULL,
  fav_count         INT UNSIGNED NOT NULL,
  is_deleted        BOOLEAN NOT NULL,
  is_pending        BOOLEAN NOT NULL,
  is_flagged        BOOLEAN NOT NULL,
  is_rating_locked  BOOLEAN NOT NULL,
  is_status_locked  BOOLEAN NOT NULL,
  is_note_locked    BOOLEAN NOT NULL,
  PRIMARY KEY (post_id),
  FOREIGN KEY (parent_id) REFERENCES posts (post_id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  INDEX (rating),
  UNIQUE INDEX (md5)
);

CREATE TABLE tags (
  tag_id  SERIAL,
  tag     VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  PRIMARY KEY (tag_id),
  UNIQUE INDEX (tag)
) COLLATE = utf8mb4_bin;

CREATE TABLE post_tags(
  post_id BIGINT UNSIGNED NOT NULL,
  tag_id  BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (post_id, tag_id),
  FOREIGN KEY (post_id) REFERENCES posts (post_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags (tag_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE post_sources(
  post_id BIGINT UNSIGNED NOT NULL,
  source  TEXT NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts (post_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE selectable_posts (
  post_id         BIGINT UNSIGNED NOT NULL,
  computed_score  INT NOT NULL,
  is_downloaded   BOOLEAN NOT NULL,
  rating          CHAR NOT NULL,
  PRIMARY KEY (post_id),
  FOREIGN KEY (post_id) REFERENCES posts (post_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX (rating, is_downloaded),
  INDEX (is_downloaded, computed_score DESC)
);

CREATE TABLE post_download_queue (
  download_id SERIAL,
  post_id     BIGINT UNSIGNED NOT NULL UNIQUE,
  priority    INT NOT NULL DEFAULT 1,
  PRIMARY KEY (download_id),
  FOREIGN KEY (post_id) REFERENCES selectable_posts (post_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  INDEX (priority DESC, download_id ASC)
);

-- Set the schema version last.
CREATE TABLE schema_version (id INT NOT NULL) SELECT 1 AS id;
