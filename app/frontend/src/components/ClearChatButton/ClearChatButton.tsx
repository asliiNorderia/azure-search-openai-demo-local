import { Delete24Regular } from "@fluentui/react-icons";
import { Button } from "@fluentui/react-components";
import { FormNew24Regular } from "@fluentui/react-icons";
import { Text } from "@fluentui/react";

import styles from "./ClearChatButton.module.css";

interface Props {
    className?: string;
    onClick: () => void;
    disabled?: boolean;
}

export const ClearChatButton = ({ className, disabled, onClick }: Props) => {
    return (
        <div className={`${styles.container} ${className ?? ""}`}>
            <FormNew24Regular />
            <Text>{"New conversation"}</Text>
        </div>
    );
};
