/*global define */
/*jslint white: true, browser: true, plusplus: true */
define([
    'jquery',
    'handlebars',
    'numeral',
    'bluebird',
    'datatables',
    'kb_common/html',
    'kb_sdk_clients/SetAPI/dev/SetAPIClient',
    'kb_service/client/workspace',
    '../utils',
    'text!../../resources/html/reads_set.html',
    'datatables_bootstrap'
], function(
    $,
    handlebars,
    Numeral,
    Promise,
    DataTable,
    html,
    SetAPI,
    Workspace,
    utils,
    RSTemplate
) {
    'use strict';

    //http://localhost:8080/#dataview/11700/set_o_reads/1
    function factory(config) {
        var parent,
            container,
            runtime = config.runtime,
            div = html.tag('div'),
            templates = $.parseHTML(RSTemplate),
            outer = templates[0].innerHTML,
            browse_fill = "{{#each readLibraries}}" +
            "<tr>" +
            "<td>{{this.name}}</td>" +
            "<td>{{this.type}}</td>" +
            "<td>{{this.data.read_count}}</td>" +
            "<td>{{this.data.read_size}}</td>" +
            "<td>{{this.data.insert_size_mean}}</td>" +
            "</tr>" +
            "{{/each}}";

        // VIEW

        function layout() {
            return div(
                html.makePanel({
                    title: 'Summary',
                    content: outer
                })
            );
        }

        function setDataElementHTML(element, value) {
            try {
                container.querySelector("[data-element='" + element + "']").innerHTML = value;
            } catch (err) {
                console.error("While setting data element '" + element + "':", err);
                throw err;
            }
        }

        function renderSummary(data) {
            var formatValue = function(data, type, row) {
                var out = Numeral(data).format('0,0');

                if (out === '0') {
                    return "Missing";
                } else {
                    return out;
                }
            };

            setDataElementHTML('reads-set-description', data.set.description);
            setDataElementHTML('reads-set-type', data.set.type);
            setDataElementHTML('reads-set-libraries-count',
                Numeral(data.set.item_count).format('0,0'));
            setDataElementHTML('reads-set-total-reads',
                Numeral(data.set.stats.read_count).format('0,0'));
            setDataElementHTML('reads-set-total-basepairs',
                Numeral(data.set.stats.bp_count).format('0,0'));
            container.querySelector('[id="reads-set-browse-id"] table tbody').innerHTML = handlebars.compile(browse_fill)({ 'readLibraries': data.row_contents });
            $('[id="reads-set-browse-id"]').removeClass('hidden');
            $('[id="reads-set-browse-table"]').DataTable({
                "columns": [
                    { data: 'name' },
                    { data: 'type' },
                    {
                        data: 'data.read_count',
                        render: formatValue
                    },
                    {
                        data: 'data.read_size',
                        render: formatValue
                    },
                    {
                        data: 'data.insert_size_mean',
                        render: formatValue
                    }
                ]
            });
        }

        // utility functions

        function getReadsSetClient() {
            return new SetAPI({
                url: runtime.getConfig('services.service_wizard.url'),
                auth: { token: runtime.service('session').getAuthToken() },
                version: 'release'
            });
        }

        function getWorkspaceClient() {
            return new Workspace(
                runtime.getConfig('services.workspace.url'), { token: runtime.service('session').getAuthToken() }
            );
        }

        function fetchReadsSet(params) {
            var setAPI = getReadsSetClient(),
                wsClient = getWorkspaceClient(),
                readsSetInfo = {};

            return setAPI.get_reads_set_v1({
                    ref: utils.getRef(params),
                    include_item_info: 1
                })
                .then(function(results) {
                    var refs = [],
                        readsTypeId,
                        readsType;

                    // pull all reads objects to calculate summary stats
                    // and individual browse row contents
                    if (results.data.items.length === 0) {
                        readsType = 'No Reads';
                    } else {
                        results.data.items.forEach(function(item, index) {
                            if (index === 0) {
                                readsTypeId = item.info[2];
                            } else if (item.info[2] !== readsTypeId) {
                                readsType = 'Mixed Reads';
                            }
                            refs.push({
                                ref: item.ref
                            });
                        });
                    }
                    if (!readsType) {
                        readsType = readsTypeId.split('-')[0].split('.')[1]
                    }
                    readsSetInfo.set = {
                        name: results.info[1],
                        type: readsType,
                        description: results.data.description,
                        items: results.data.items,
                        item_count: results.data.items.length
                    };

                    return refs;
                })
                .then(function(refs) {
                    if (refs.length) {
                        return wsClient.get_objects(refs);
                    } else {
                        return [];
                    }
                })
                .then(function(data) {
                    var i = 0;

                    readsSetInfo.row_contents = data;
                    readsSetInfo.set.stats = {
                        read_count: 0,
                        bp_count: 0
                    };
                    // calculate summary stats
                    for (i = 0; i < data.length; i++) {
                        readsSetInfo.row_contents[i].name = data[i].info[1];
                        readsSetInfo.row_contents[i].type = data[i].info[2].split('-')[0].split('.')[1];
                        if (data[i].data.hasOwnProperty('read_count')) {
                            readsSetInfo.set.stats.read_count += data[i].data.read_count;
                            if (data[i].data.hasOwnProperty('read_size')) {
                                readsSetInfo.set.stats.bp_count += data[i].data.read_count * data[i].data.read_size;
                            }
                        }
                    }
                    return readsSetInfo;
                })
                .error(function(err) {
                    console.error(err);
                    container.empty();
                    container.appendChild('Error' + JSON.stringify(err));
                });
        }

        // WIDGET API
        function attach(node) {
            parent = node;
            container = parent.appendChild(document.createElement('div'));
            container.innerHTML = layout();
        }

        function start(params) {
            Array.prototype.slice.call(container.querySelectorAll("[data-element]"))
                .forEach(function(e) {
                    e.innerHTML = html.loading();
                });

            return fetchReadsSet(params).then(function(results) {
                renderSummary(results);
            });
        }

        function stop() {
            // nothing to do
        }

        function detach() {
            // nothing to do necessarily, since the parent dom node will
            // be removed the controller for this widget removes it, 
            // but it is nice to take responsibility for undoing what we
            // changed in the parent node:
            if (parent && container) {
                container.innerHTML = '';
                parent.removeChild(container);
            }
        }

        return Object.freeze({
            attach: attach,
            start: start,
            stop: stop,
            detach: detach
        });
    }

    return {
        make: function(config) {
            return factory(config);
        }
    };
});