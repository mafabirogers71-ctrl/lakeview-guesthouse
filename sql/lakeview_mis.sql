-- Lakeview Guest House MIS database
-- Import in phpMyAdmin: Import tab > choose this file > Go
CREATE DATABASE IF NOT EXISTS lakeview_mis CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE lakeview_mis;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS orders, payments, bookings, inventory, suppliers, menu_items, rooms, room_types, guests, users;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  user_id       INT AUTO_INCREMENT PRIMARY KEY,
  full_name     VARCHAR(80)  NOT NULL,
  username      VARCHAR(40)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('receptionist','manager','accountant') NOT NULL
) ENGINE=InnoDB;

CREATE TABLE guests (
  guest_id INT AUTO_INCREMENT PRIMARY KEY,
  name     VARCHAR(80) NOT NULL,
  phone    VARCHAR(20) NOT NULL UNIQUE,
  email    VARCHAR(80) NULL,
  id_no    VARCHAR(30) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE room_types (
  type_id INT AUTO_INCREMENT PRIMARY KEY,
  name    VARCHAR(40) NOT NULL UNIQUE,
  rate    INT NOT NULL CHECK (rate > 0)
) ENGINE=InnoDB;

CREATE TABLE rooms (
  room_id  INT AUTO_INCREMENT PRIMARY KEY,
  room_no  VARCHAR(10) NOT NULL UNIQUE,
  type_id  INT NOT NULL,
  maintenance TINYINT(1) NOT NULL DEFAULT 0,
  FOREIGN KEY (type_id) REFERENCES room_types(type_id)
) ENGINE=InnoDB;

CREATE TABLE bookings (
  booking_id INT AUTO_INCREMENT PRIMARY KEY,
  guest_id   INT NOT NULL,
  room_id    INT NOT NULL,
  check_in   DATE NOT NULL,
  check_out  DATE NOT NULL,
  status     ENUM('Reserved','Checked in','Checked out','Cancelled') NOT NULL DEFAULT 'Reserved',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (guest_id) REFERENCES guests(guest_id),
  FOREIGN KEY (room_id)  REFERENCES rooms(room_id),
  CHECK (check_out > check_in)
) ENGINE=InnoDB;

CREATE TABLE payments (
  payment_id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  amount     INT NOT NULL CHECK (amount > 0),
  method     ENUM('Cash','Mobile Money','Card') NOT NULL,
  paid_on    DATE NOT NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(booking_id)
) ENGINE=InnoDB;

CREATE TABLE menu_items (
  item_id INT AUTO_INCREMENT PRIMARY KEY,
  name    VARCHAR(60) NOT NULL,
  price   INT NOT NULL CHECK (price > 0)
) ENGINE=InnoDB;

CREATE TABLE orders (
  order_id   INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  item_id    INT NOT NULL,
  qty        INT NOT NULL CHECK (qty > 0),
  ordered_on DATE NOT NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(booking_id),
  FOREIGN KEY (item_id)    REFERENCES menu_items(item_id)
) ENGINE=InnoDB;

CREATE TABLE suppliers (
  supplier_id INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(80) NOT NULL,
  phone       VARCHAR(20) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE inventory (
  stock_id      INT AUTO_INCREMENT PRIMARY KEY,
  item          VARCHAR(60) NOT NULL,
  qty           INT NOT NULL CHECK (qty >= 0),
  reorder_level INT NOT NULL,
  supplier_id   INT NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id)
) ENGINE=InnoDB;

-- ---------- Sample data (matches the front-end demo) ----------
INSERT INTO room_types (name, rate) VALUES ('Standard',80000),('Deluxe',120000),('Suite',200000);

INSERT INTO rooms (room_no, type_id) VALUES
('101',1),('102',1),('103',1),('104',1),('105',1),
('201',2),('202',2),('203',2),('204',2),('205',2),
('301',3),('302',3);

INSERT INTO guests (name, phone, id_no) VALUES
('Grace Namukasa','0772000111','CF9001'),
('Peter Okello','0701222333','CM8812'),
('Sarah Kintu','0783444555','CF7733');

INSERT INTO bookings (guest_id, room_id, check_in, check_out, status) VALUES
(1, 2,  CURDATE() - INTERVAL 1 DAY, CURDATE() + INTERVAL 2 DAY, 'Checked in'),
(2, 7,  CURDATE(),                  CURDATE() + INTERVAL 3 DAY, 'Reserved'),
(3, 11, CURDATE() - INTERVAL 2 DAY, CURDATE(),                  'Checked in');

INSERT INTO payments (booking_id, amount, method, paid_on) VALUES
(1, 100000, 'Cash',         CURDATE() - INTERVAL 1 DAY),
(3, 300000, 'Mobile Money', CURDATE() - INTERVAL 2 DAY),
(3,  50000, 'Cash',         CURDATE() - INTERVAL 4 DAY);

INSERT INTO menu_items (name, price) VALUES
('Matoke and beef stew',15000),('Chicken luwombo',25000),('Nile perch fillet',30000),('Soda',3000),('Nile Special beer',5000);

INSERT INTO orders (booking_id, item_id, qty, ordered_on) VALUES (1, 2, 1, CURDATE());

INSERT INTO suppliers (name, phone) VALUES ('Entebbe Wholesale Foods','0780111222'),('Lake Drinks Distributors','0750333444');

INSERT INTO inventory (item, qty, reorder_level, supplier_id) VALUES
('Bar beer crates',14,10,2),('Rice (kg)',40,25,1),('Cooking oil (litres)',6,10,1),
('Bed linen sets',30,20,NULL),('Soap and toiletries',12,15,NULL);
