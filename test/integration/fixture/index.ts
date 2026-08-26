import './bridge-fixture.scss';
import template from './bridge-fixture.html.twig';

export default Shopware.Component.wrapComponentConfig({
    template,

    props: {
        label: {
            type: String,
            required: true,
        },
    },

    data() {
        return { count: 0 };
    },

    methods: {
        increment(this: { count: number }): void {
            this.count += 1;
        },
    },
});
