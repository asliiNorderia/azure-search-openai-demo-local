import { Example } from "./Example";

import styles from "./Example.module.css";

export type GeneralExampleModel = {
    text: string;
    value: string;
};

const EXAMPLES: GeneralExampleModel[] = [
    /*{
        text: "What is included in my Northwind Health Plus plan that is not in standard?",
        value: "What is included in my Northwind Health Plus plan that is not in standard?"
    },
    { text: "What happens in a performance review?", value: "What happens in a performance review?" },
    { text: "What does a Product Manager do?", value: "What does a Product Manager do?" }*/
    { text: "How can I get access to SAP Learning Hub?", value: "How can I get access to SAP Learning Hub?" },
    { text: "What is Citrix?", value: "What is Citrix?" },
    { text: "Can you list top 5 functionalities of Azure?", value: "Can you list top 5 functionalities of Azure?" }
];

interface Props {
    onExampleClicked: (value: string) => void;
}

export const GeneralExampleList = ({ onExampleClicked }: Props) => {
    return (
        <ul className={styles.examplesNavList}>
            {EXAMPLES.map((x, i) => (
                <li key={i}>
                    <Example text={x.text} value={x.value} onClick={onExampleClicked} />
                </li>
            ))}
        </ul>
    );
};
