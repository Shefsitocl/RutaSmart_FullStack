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

## Execution Environment (Local Only)

**This project is not deployed to a public website.** It is designed to run entirely on a local machine using the following software:

1.  **XAMPP**: Manages and runs the required **MySQL database**.
2.  **Visual Studio Code**: Used to run the **Node.js backend server** and launch the **frontend** using the "Live Server" extension.

The backend API runs locally (e.g., `http://localhost:4000`), and the frontend is served by "Live Server" (e.g., `http://127.0.0.1:5500`).

-----

## Setup and Installation

### 1\. Requirements

  * **XAMPP**: For MySQL database management.
  * **Node.js**: Version 16 or higher.
  * **Visual Studio Code**: As the primary code editor.
  * **Live Server (VS Code Extension)**: Install this extension from the VS Code marketplace.

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

          npm install
  
4.  Create a `.env` file in the project root.

5.  Copy the following configuration into the `.env` file:

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

 **Note**: This configuration assumes a default XAMPP setup (`root` user with no password). Adjust `DB_PASS` if your MySQL configuration differs.

## Running the Application

### Step 1: Create Initial Admin User (First Run Only)

Before launching the server, you must create the initial admin account.

1.  Ensure the XAMPP MySQL service is running.
2.  In the VS Code terminal, run the following script:
 
       npm run create-admin

3.  This creates the default user (**Username**: `admin`, **Password**: `admin1234`).

### Step 2: Start the Backend Server

Run the following command in your VS Code terminal to start the server with auto-reloading:

        npm run dev

The backend API will now be running on `http://localhost:4000`. Keep this terminal process running.

### Step 3: Launch the Frontend (Live Server)

1.  In the Visual Studio Code file explorer, right-click on the `index.html` file.
2.  Select **"Open with Live Server"**.
3.  Your browser will automatically open to the correct address (e.g., `http://127.0.0.1:5500/index.html`), and the frontend will be connected to your running backend.

You can now log in to the application using the admin credentials created in Step 1.
