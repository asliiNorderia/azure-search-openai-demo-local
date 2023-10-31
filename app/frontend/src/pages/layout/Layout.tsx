import { Outlet, NavLink, Link } from "react-router-dom";

import logonorderia from "../../assets/logo-norderia.svg";

import styles from "./Layout.module.css";
import leftLogo from "../../assets/leftLogo.png";

import { useLogin } from "../../authConfig";

import { LoginButton } from "../../components/LoginButton";

const Layout = () => {
    return (
        <div className={styles.layout}>
            <header className={styles.header} role={"banner"}>
                <div className={styles.headerContainer}>
                    <img src={leftLogo} alt="NoraChat" width="100" height="19.48" className={styles.leftLogo}></img>
                    <nav>
                        <ul className={styles.headerNavList}>
                            <li>
                                <NavLink to="/" className={({ isActive }) => (isActive ? styles.headerNavPageLinkActive : styles.headerNavPageLink)}>
                                    SAP Chat
                                </NavLink>
                            </li>
                            <li className={styles.headerNavLeftMargin}>
                                <NavLink to="/gch" className={({ isActive }) => (isActive ? styles.headerNavPageLinkActive : styles.headerNavPageLink)}>
                                    General Chat
                                </NavLink>
                            </li>
                            <li className={styles.headerNavLeftMargin}>
                                <NavLink to="/qa" className={({ isActive }) => (isActive ? styles.headerNavPageLinkActive : styles.headerNavPageLink)}>
                                    Ask Your Data
                                </NavLink>
                            </li>
                        </ul>
                    </nav>
                    <h4 className={styles.headerRightText}>
                        <a href="https://www.norderia.com/" target={"_blank"} title="Norderia Website">
                            <img src={logonorderia} alt="Powered By Norderia" width="100" height="19.48" className={styles.norderiaLogo}></img>
                        </a>
                    </h4>
                    {useLogin && <LoginButton />}
                </div>
            </header>

            <Outlet />
        </div>
    );
};

export default Layout;
