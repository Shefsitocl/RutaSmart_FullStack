# RutaSmart: Integrated Backend & Frontend

## Project Overview

This repository contains the source code for the RutaSmart project. It includes the Node.js/Express API backend and the corresponding HTML/CSS/JS frontend for the admin panel and driver view.

**Tech Stack:**

  * **Backend**: Node.js, Express
  * **Database**: MySQL
  * **Frontend**: Vanilla HTML5, CSS3, JavaScript
  * **Authentication**: JSON Web Tokens (JWT) via HttpOnly Cookies
  * **APIs**: Google Maps (Geocoding, Directions, Distance Matrix)

-----

## Setup and Installation

### 1\. Requirements

  * **XAMPP**: For MySQL database management.
  * **Node.js**: Version 16 or higher.
  * **Visual Studio Code**: Or a preferred code editor.

### 2\. Database Setup (XAMPP)

1.  Start the **MySQL** service via the XAMPP control panel.
2.  Navigate to `http://localhost/phpmyadmin`.
3.  Create a new database named **`myapp_db`**.
4.  Select the `myapp_db` database.
5.  Go to the **Import** tab.
6.  Choose the `schema.sql` file from this project and execute the import. This will create all required tables and roles.

### 3\. Backend Setup (Node.js)

1.  Open the project folder in Visual Studio Code.

2.  Open an integrated terminal (\`Ctrl + \`\`).

3.  Install all Node.js dependencies:

    ```bash
    npm install
    ```

4.  Create a `.env` file in the project root.

5.  Copy the following configuration into the `.env` file:

    ```ini
    # MySQL (Default XAMPP)
    DB_HOST=127.0.0.1
    DB_PORT=3306
    DB_USER=root
    DB_PASS=
    DB_NAME=myapp_db
    DB_CONN_LIMIT=10

    # JWT Security
    JWT_SECRET=NACIMOS_PARA_MORIR_DIJO_LANA_DEL_REY
    JWT_EXPIRES_IN=1h

    # Server
    PORT=4000
    NODE_ENV=development

    # SECURITY
    BCRYPT_SALT_ROUNDS=12
    COOKIE_SECURE=false
    COOKIE_SAMESITE=Lax
    ```

    > **Note**: This configuration assumes a default XAMPP setup (`root` user with no password). Adjust `DB_PASS` if your MySQL configuration differs.

-----

## Running the Application

### Step 1: Create Initial Admin User (First Run Only)

Before launching the server, you must create the initial admin account.

1.  Ensure the XAMPP MySQL service is running.
2.  In the VS Code terminal, run the following script:
    ```bash
    npm run create-admin
    ```
3.  This creates the default user (**Username**: `admin`, **Password**: `admin1s234`).

### Step 2: Start the Backend Server

Run one of the following commands in your terminal:

  * **Development Mode (Recommended)**: Uses `nodemon` for auto-reloading on file changes.
    ```bash
    npm run dev
    ```
  * **Production Mode**:
    ```bash
    npm start
    ```

The backend API will be running on `http://localhost:4000`. Keep this terminal process running.

### Step 3: Launch the Frontend

The frontend is designed to communicate with the running backend.

  * **Option 1 (Live Server)**: Install the "Live Server" extension in VS Code. Right-click `index.html` and select "Open with Live Server".
  * **Option 2 (File System)**: Open the `index.html` file directly in your web browser.

You can now log in to the application using the admin credentials created in Step 1.

### Optional
you can use 