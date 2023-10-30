import avatar from "../../assets/avatarAnswer.gif";
import styles from "./Answer.module.css";

export const AnswerIcon = () => {
    return <img src={avatar} alt="Norderia" width="60" height="60" className={styles.avatar}></img>;
};
