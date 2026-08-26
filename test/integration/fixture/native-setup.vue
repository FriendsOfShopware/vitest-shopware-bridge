<template>
    <p class="native-setup">{{ label }}</p>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const label = computed(() => 'Native Shopware setup works');

swDefinePublic({
    label,
});
</script>
